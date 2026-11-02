import { ServerError } from '../../shared/errors.ts'
import { errorPayload } from '../../shared/i18n.ts'
import type { DetectedOs } from '../../shared/operating-systems.ts'
import { type TypeLease } from '../definitions/model.ts'
import { detectionEligibility } from '../definitions/policies.ts'
import { canonical } from '../recipes/canonical.ts'
import { candidatesFor, environment, observe } from '../recipes/planning.ts'
import { invokeRecipe } from '../recipes/protocol.ts'
import { type SshSession } from '../remote/ssh.ts'
import type { UpdateCheck } from './model.ts'

/** Read-only candidate resolution. Neither a detection preference nor a due reminder authorizes execute. */
export async function detectUpdates(
  session: SshSession,
  lease: TypeLease,
  os: DetectedOs,
  selected?: readonly string[],
): Promise<UpdateCheck[]> {
  const checks: UpdateCheck[] = []
  for (const c of lease.components) {
    if (selected && !selected.includes(c.software_key)) continue
    const before = await observe(session, c, os),
      check: UpdateCheck = { software: c.software_key, before, eligible: [], reason: null, errors: [] }
    checks.push(check)
    if (before.state === 'unknown') {
      check.reason = 'detection_failed'
      continue
    }
    if (before.state === 'missing') {
      check.reason = 'not_installed'
      continue
    }
    if (!before.healthy) {
      check.reason = 'unhealthy'
      continue
    }
    if (!c.adapter.contains(c.versions, before.version)) {
      check.reason = 'version_conflict'
      continue
    }
    check.reason = detectionEligibility(c, before.version)
    if (check.reason) continue
    if (!c.actions.includes('upgrade') || !c.scripts.resolve) {
      check.reason = 'recipe_unavailable'
      continue
    }
    try {
      const candidates = await candidatesFor(session, c, os, before)
      for (const candidate of candidates.filter((v) => c.adapter.compare(v.version, before.version) > 0)) {
        try {
          const resolved = await invokeRecipe(session, c.scripts.resolve, {
            ...environment(c, os),
            operation: 'resolve',
            action: 'upgrade',
            installed: before,
            target: candidate,
          })
          if (
            resolved.operation !== 'resolve' ||
            resolved.change.action !== 'upgrade' ||
            canonical(resolved.change.before) !== canonical(before) ||
            canonical(resolved.change.target) !== canonical(candidate) ||
            resolved.change.dependencies.some(
              (key) =>
                !c.requires.some(
                  (id) => lease.components.find((item) => item.id === id)?.software_key === key,
                ),
            )
          )
            throw new ServerError('plan_conflict')
          check.eligible.push(candidate)
        } catch (cause) {
          check.errors.push(
            errorPayload(cause instanceof ServerError ? cause : new ServerError('plan_conflict')),
          )
        }
      }
    } catch (cause) {
      check.reason = 'detection_failed'
      check.errors.push(
        errorPayload(cause instanceof ServerError ? cause : new ServerError('request_failed')),
      )
    }
  }
  return checks
}
