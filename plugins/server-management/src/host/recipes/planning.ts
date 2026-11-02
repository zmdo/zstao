import type { PreparedPlan } from '../../shared/changes.ts'
import type {
  Candidate,
  ResolvedSoftwareChange,
  SoftwareObservation,
} from '../../shared/contracts/recipes.ts'
import { ServerError } from '../../shared/errors.ts'
import { errorDetail } from '../../shared/i18n.ts'
import type { DetectedOs } from '../../shared/operating-systems.ts'
import { type Component } from '../definitions/catalog.ts'
import { type TypeLease } from '../definitions/model.ts'
import { type SshSession } from '../remote/ssh.ts'
import { canonical } from './canonical.ts'
import { invokeRecipe } from './protocol.ts'

export function environment(component: Component, os: DetectedOs) {
  return {
    contractVersion: 2 as const,
    os: { ...os, raw: {} },
    software: component.software_key,
    recipe: component.recipe,
    recipeRevision: component.revision,
    effectiveVersions: component.versions,
  }
}
export async function observe(
  session: SshSession,
  component: Component,
  os: DetectedOs,
): Promise<SoftwareObservation> {
  try {
    const result = await invokeRecipe(session, component.scripts.detect, {
      ...environment(component, os),
      operation: 'detect',
    })
    if (result.operation !== 'detect') throw new ServerError('recipe_protocol')
    if (result.result.state === 'installed') component.adapter.normalize(result.result.version)
    return result.result
  } catch (cause) {
    return {
      state: 'unknown',
      code: cause instanceof ServerError ? cause.code : 'detection_failed',
      detail: errorDetail(cause, ''),
    }
  }
}
export async function candidatesFor(
  session: SshSession,
  component: Component,
  os: DetectedOs,
  before: SoftwareObservation,
): Promise<Candidate[]> {
  if (!component.scripts.listCandidates) throw new ServerError('recipe_unavailable')
  const result = await invokeRecipe(session, component.scripts.listCandidates, {
    ...environment(component, os),
    operation: 'list-candidates',
    installed: before,
  })
  if (result.operation !== 'list-candidates') throw new ServerError('recipe_protocol')
  return result.candidates
    .filter((c) => c.channel === 'stable' && component.adapter.contains(component.versions, c.version))
    .sort(
      (a, b) =>
        component.adapter.compare(b.version, a.version) || a.targetIdentity.localeCompare(b.targetIdentity),
    )
}
export interface PlanSelection {
  mode: 'prepare' | 'move' | 'upgrade'
  versions?: Record<string, string>
  installMissing?: boolean
}
export async function preparePlan(
  session: SshSession,
  lease: TypeLease,
  os: DetectedOs,
  selection: PlanSelection = { mode: 'prepare', installMissing: true },
): Promise<PreparedPlan> {
  const changes: ResolvedSoftwareChange[] = []
  for (const component of lease.components) {
    const before = await observe(session, component, os)
    if (before.state === 'unknown')
      throw new ServerError('software_detection_unknown', { detail: before.detail ?? before.code })
    const base = {
      software: component.software_key,
      recipe: component.recipe,
      recipeRevision: component.revision,
      before,
      dependencies: component.requires.map(
        (id) => lease.components.find((item) => item.id === id)!.software_key,
      ),
    }
    const requested = selection.versions?.[component.software_key]
    const compliant =
      before.state === 'installed' &&
      before.healthy &&
      component.adapter.contains(component.versions, before.version)
    if (!requested && compliant) {
      changes.push({ ...base, action: 'keep', effects: [], payload: null })
      continue
    }
    if (before.state === 'missing' && selection.mode === 'upgrade') {
      if (requested) throw new ServerError('plan_conflict')
      changes.push({ ...base, action: 'defer-install', effects: [], payload: null })
      continue
    }
    if (before.state === 'missing' && selection.mode === 'move' && !selection.installMissing) {
      changes.push({ ...base, action: 'defer-install', effects: [], payload: null })
      continue
    }
    if (selection.mode === 'prepare' && before.state === 'installed') throw new ServerError('plan_conflict')
    if (selection.mode === 'upgrade' && !requested) throw new ServerError('plan_conflict')
    const eligible = await candidatesFor(session, component, os, before)
    const target = requested
      ? eligible.find((c) => component.adapter.compare(c.version, requested) === 0)
      : eligible[0]
    if (!target) throw new ServerError('recipe_unavailable')
    if (
      selection.mode === 'upgrade' &&
      before.state === 'installed' &&
      component.adapter.compare(target.version, before.version) <= 0
    )
      throw new ServerError('plan_conflict')
    const action =
      before.state === 'missing' ? 'install' : selection.mode === 'upgrade' ? 'upgrade' : 'replace'
    if (
      !component.actions.includes(action) ||
      !component.scripts.resolve ||
      !component.scripts.execute ||
      !component.scripts.verify ||
      !component.scripts.recover
    )
      throw new ServerError('recipe_unavailable')
    const resolved = await invokeRecipe(session, component.scripts.resolve, {
      ...environment(component, os),
      operation: 'resolve',
      action,
      target,
      installed: before,
    })
    if (
      resolved.operation !== 'resolve' ||
      resolved.change.action !== action ||
      canonical(resolved.change.before) !== canonical(before) ||
      canonical(resolved.change.target) !== canonical(target) ||
      resolved.change.dependencies.some((key) => !base.dependencies.includes(key))
    )
      throw new ServerError('plan_conflict')
    changes.push({ ...resolved.change, ...base, action, target })
  }
  const packages = new Map<string, string>()
  for (const change of changes) {
    const payload = change.payload
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !('packages' in payload) ||
      !Array.isArray(payload.packages)
    )
      continue
    for (const item of payload.packages) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || item.manager !== 'apt') continue
      const key = `${item.manager}/${item.name}/${item.architecture}`
      const snapshot = canonical(item)
      if (packages.has(key) && packages.get(key) !== snapshot) throw new ServerError('plan_conflict')
      packages.set(key, snapshot)
    }
  }
  for (const change of changes) {
    if (change.before.state !== 'installed') continue
    const expected = change.target?.packages ?? change.before.packages
    for (const pkg of expected) {
      const key = `${pkg.manager}/${pkg.name}/${pkg.architecture}`
      const planned = packages.get(key)
      if (planned && (JSON.parse(planned) as { version: string }).version !== pkg.version)
        throw new ServerError('plan_conflict')
    }
  }
  return {
    targetType: lease.type,
    definitionRevision: lease.signature,
    os,
    changes,
    risks: {
      major: changes.some(
        (ch, i) =>
          ch.before.state === 'installed' &&
          !!ch.target &&
          lease.components[i]!.adapter.isMajorChange(ch.before.version, ch.target.version),
      ),
      replacement: changes.some((ch) => ch.action === 'replace'),
      serviceImpact: changes.some((ch) => ch.effects.length > 0),
    },
  }
}
export async function checkPlan(session: SshSession, lease: TypeLease, plan: PreparedPlan): Promise<void> {
  if (lease.signature !== plan.definitionRevision || plan.changes.length !== lease.components.length)
    throw new ServerError('job_definition_changed')
  for (let index = 0; index < plan.changes.length; index++) {
    const change = plan.changes[index]!,
      component = lease.components[index]!
    if (change.software !== component.software_key || change.recipeRevision !== component.revision)
      throw new ServerError('job_definition_changed')
    const actual = await observe(session, component, plan.os)
    if (change.action === 'keep' || change.action === 'defer-install') {
      if (canonical(actual) !== canonical(change.before)) throw new ServerError('plan_conflict')
      continue
    }
    if (!['install', 'upgrade', 'replace'].includes(change.action) || !change.target)
      throw new ServerError('plan_conflict')
    if (
      actual.state === 'installed' &&
      actual.healthy &&
      actual.targetIdentity === change.target.targetIdentity
    )
      continue
    if (canonical(actual) !== canonical(change.before)) throw new ServerError('plan_conflict')
    const candidates = await invokeRecipe(session, component.scripts.listCandidates!, {
      ...environment(component, plan.os),
      operation: 'list-candidates',
      installed: actual,
    })
    if (
      candidates.operation !== 'list-candidates' ||
      !candidates.candidates.some((candidate) => canonical(candidate) === canonical(change.target))
    )
      throw new ServerError('plan_conflict')
    const current = await invokeRecipe(session, component.scripts.resolve!, {
      ...environment(component, plan.os),
      operation: 'resolve',
      action: change.action as 'install' | 'upgrade' | 'replace',
      target: change.target,
      installed: actual,
    })
    if (
      current.operation !== 'resolve' ||
      canonical(current.change.payload) !== canonical(change.payload) ||
      canonical(current.change.effects) !== canonical(change.effects)
    )
      throw new ServerError('plan_conflict')
  }
}
