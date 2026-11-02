import { randomUUID } from 'node:crypto'
import { type ChangeRequest, type ChangeSelection, type PreparedPlan } from '../../shared/changes.ts'
import { type ServerTypeView } from '../../shared/definitions.ts'
import { ServerError } from '../../shared/errors.ts'
import { type Db } from '../database/connection.ts'
import { transaction } from '../database/transaction.ts'
import { parsePolicies, restrictLease } from '../definitions/policies.ts'
import { type DefinitionRegistry } from '../definitions/registry.ts'
import { HttpError } from '../errors.ts'
import { type JobRecord } from '../execution/persistence/rows.ts'
import { UUID } from '../input.ts'
import { digest } from '../recipes/canonical.ts'
import { writePolicies } from '../servers/persistence/policy-repository.ts'
import * as servers from '../servers/persistence/repository.ts'
import { type ServerSecret } from '../servers/persistence/rows.ts'
import * as plans from './persistence/repository.ts'

export async function createChangePlan(
  db: Db,
  definitions: DefinitionRegistry,
  input: unknown,
): Promise<string> {
  if (!input || typeof input !== 'object') throw new ServerError('upgrade_invalid')
  const value = input as Record<string, unknown>,
    kind = value.kind
  if (kind !== 'move' && kind !== 'upgrade') throw new ServerError('upgrade_invalid')
  if (
    !Array.isArray(value.server_ids) ||
    !value.server_ids.length ||
    value.server_ids.length > 500 ||
    value.server_ids.some((id) => typeof id !== 'string' || !UUID.test(id))
  )
    throw new ServerError('upgrade_invalid')
  const ids = [...new Set(value.server_ids as string[])].sort()
  const versions: Record<string, string> = {}
  if (kind === 'upgrade') {
    if (!value.versions || typeof value.versions !== 'object' || Array.isArray(value.versions))
      throw new ServerError('upgrade_invalid')
    for (const [key, version] of Object.entries(value.versions)) {
      if (typeof version !== 'string' || version.length > 128 || key.length > 200)
        throw new ServerError('upgrade_invalid')
      versions[key] = version
    }
    if (!Object.keys(versions).length) throw new ServerError('upgrade_invalid')
  }
  let binding: ChangeSelection['binding']
  if (kind === 'move') {
    if (
      ids.length !== 1 ||
      (value.group_id !== null && (typeof value.group_id !== 'string' || !UUID.test(value.group_id))) ||
      typeof value.type_key !== 'string' ||
      typeof value.install_missing !== 'boolean'
    )
      throw new ServerError('upgrade_invalid')
    binding = {
      groupId: value.group_id as string | null,
      typeKey: value.type_key,
      installMissing: value.install_missing,
      policies: parsePolicies(value.software_policies),
    }
  }
  const selection: ChangeSelection = { serverIds: ids, versions, ...(binding ? { binding } : {}) }
  const id = randomUUID()
  await transaction(db, async (c) => {
    const servers = (await plans.lockServers(c, ids)).rows
    if (servers.length !== ids.length) throw new ServerError('server_not_found')
    if (binding) {
      const lease = await definitions.lease(binding.groupId, binding.typeKey, servers[0]!.declared_os)
      if (!lease) throw new ServerError('type_unavailable')
      try {
        restrictLease(lease, binding.policies)
      } finally {
        lease.release()
      }
    }
    await plans.insertPlan(c, { id, kind, snapshot: JSON.stringify({ selection }) })
    for (const s of servers) {
      const target = randomUUID(),
        job = randomUUID()
      await plans.insertTarget(c, {
        id: target,
        planId: id,
        serverId: s.id,
        snapshot: JSON.stringify({ id: s.id, name: s.name, host: s.host }),
        configRevision: s.config_revision,
        environmentRevision: s.environment_revision,
      })
      await plans.insertPreflightJob(c, {
        id: job,
        serverId: s.id,
        targetId: target,
        configRevision: s.config_revision,
        environmentRevision: s.environment_revision,
        operationId: randomUUID(),
        snapshot: JSON.stringify({ action: 'preflight_' + kind, planId: id }),
      })
    }
  })
  return id
}

export async function preflightRequest(db: Db, job: JobRecord): Promise<ChangeRequest> {
  const row = (await plans.draftForTarget(db, job.target_id)).rows[0]
  if (!row) throw new ServerError('plan_not_ready')
  return row.request_snapshot
}

/** Uses the caller's fenced worker transaction; repositories never commit independently. */
export async function savePreflight(
  db: Db,
  job: JobRecord,
  server: ServerSecret,
  plan: PreparedPlan,
): Promise<void> {
  const target = (await plans.targetParent(db, job.target_id)).rows[0]
  if (!target) throw new ServerError('plan_not_ready')
  const parent = (await plans.lockPlan(db, target.plan_id)).rows[0]!
  if (parent.state !== 'draft') throw new ServerError('plan_not_ready')
  await plans.readyPreflight(db, {
    targetId: job.target_id,
    snapshot: JSON.stringify(plan),
    definitionRevision: plan.definitionRevision,
    environmentRevision: server.environment_revision,
  })
}

/** Runs in fenced completion so a late worker cannot overwrite a cancelled plan. */
export async function finishPreflight(db: Db, job: JobRecord, state: string, result: unknown): Promise<void> {
  const target = (await plans.targetParent(db, job.target_id)).rows[0]
  if (!target) return
  const parent = (await plans.lockPlan(db, target.plan_id)).rows[0]!
  if (parent.state !== 'draft') return
  if (state !== 'succeeded') await plans.failPreflight(db, job.target_id, JSON.stringify(result))
  const targets = (await plans.preflightStates(db, parent.id)).rows
  if (targets.some((t) => t.preflight_state === 'queued')) return
  await plans.setPlanState(
    db,
    parent.id,
    targets.some((t) => t.preflight_state === 'failed') ? 'blocked' : 'awaiting_confirmation',
  )
}

function frozenTargets(targets: Awaited<ReturnType<typeof targetRows>>) {
  return targets.map((t) => ({
    id: t.id,
    serverId: t.server_id,
    configRevision: String(t.expected_config_revision),
    environmentRevision: String(t.expected_environment_revision),
    definitionRevision: t.definition_revision,
    plan: t.target_snapshot,
  }))
}

export async function readChangePlan(db: Db, id: string) {
  const plan = (await plans.readPlan(db, id)).rows[0]
  if (!plan) throw new HttpError(404, 'plan_not_ready')
  const targets = await targetRows(db, id)
  return {
    ...plan,
    targets,
    review_digest: digest({ selection: plan.request_snapshot.selection, targets: frozenTargets(targets) }),
  }
}

export async function confirmChangePlan(db: Db, id: string, input: Record<string, unknown>): Promise<void> {
  await transaction(db, async (c) => {
    const plan = (await plans.lockPlan(c, id)).rows[0]
    if (!plan || plan.state !== 'awaiting_confirmation' || String(input.revision) !== String(plan.revision))
      throw new ServerError('plan_not_ready')
    const targets = await targetRows(c, id),
      frozen = frozenTargets(targets)
    if (
      input.review_digest !== digest({ selection: plan.request_snapshot.selection, targets: frozen }) ||
      targets.some((t) => t.preflight_state !== 'ready')
    )
      throw new ServerError('plan_not_ready')
    const start = new Date(String(input.start)),
      end = new Date(String(input.end)),
      timezone = String(input.timezone),
      concurrency = Number(input.concurrency)
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
    } catch (cause) {
      throw new ServerError('upgrade_invalid', {}, { cause })
    }
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end.getTime() <= Date.now() ||
      end <= start ||
      end.getTime() - start.getTime() > 7 * 86400000 ||
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 4
    )
      throw new ServerError('upgrade_invalid')
    const changes = targets.flatMap((t) => t.target_snapshot.changes),
      mutations = changes.filter((ch) => ['install', 'upgrade', 'replace'].includes(ch.action))
    if (
      (mutations.some((ch) => ch.action === 'replace') && input.ack_replacement !== true) ||
      (targets.some((t) => t.target_snapshot.risks?.major) && input.ack_major !== true) ||
      (mutations.some((ch) => ch.effects.length) && input.ack_service_impact !== true)
    )
      throw new ServerError('plan_ack_required')
    for (const t of targets) {
      const current = (await plans.serverRevisions(c, t.server_id)).rows[0]
      if (
        !current ||
        String(current.config_revision) !== String(t.expected_config_revision) ||
        String(current.environment_revision) !== String(t.expected_environment_revision)
      )
        throw new ServerError('job_configuration_changed')
    }
    const request: ChangeRequest = {
      ...plan.request_snapshot,
      targets: frozen,
      execution: { start: start.toISOString(), end: end.toISOString(), timezone, concurrency },
      acknowledgments: {
        replacement: input.ack_replacement === true,
        major: input.ack_major === true,
        serviceImpact: input.ack_service_impact === true,
      },
    }
    const fingerprint = digest(request)
    await plans.schedulePlan(c, {
      id,
      snapshot: JSON.stringify(request),
      fingerprint,
      start,
      end,
      timezone,
      concurrency,
    })
    for (const t of targets) {
      const jobId = randomUUID()
      await plans.insertApplyJob(c, {
        id: jobId,
        serverId: t.server_id,
        targetId: t.id,
        configRevision: t.expected_config_revision,
        environmentRevision: t.expected_environment_revision,
        definitionRevision: t.definition_revision,
        operationId: randomUUID(),
        snapshot: JSON.stringify({
          action: plan.kind === 'move' ? 'move_server' : 'upgrade_software',
          planId: id,
          digest: fingerprint,
        }),
      })
    }
  })
}

export async function controlPlan(db: Db, id: string, action: 'pause' | 'cancel'): Promise<void> {
  await transaction(db, async (c) => {
    const p = (await plans.lockPlan(c, id)).rows[0]
    if (
      !p ||
      ![
        'draft',
        'awaiting_confirmation',
        'scheduled',
        'running',
        'paused',
        'blocked',
        'partial_failure',
      ].includes(p.state)
    )
      throw new ServerError('plan_not_ready')
    await plans.setPlanState(c, id, action === 'pause' ? 'paused' : 'cancelled')
    if (action === 'cancel') {
      await plans.cancelQueuedJobs(c, id)
      await plans.cancelPendingTargets(c, id)
    }
  })
}

/** Binding, policies and verified facts commit with successful fenced task completion. */
export async function commitBinding(db: Db, job: JobRecord, type: ServerTypeView | undefined): Promise<void> {
  if (!job.target_id) return
  const p = (await plans.planForTarget(db, job.target_id)).rows[0]
  const b = p?.request_snapshot.selection?.binding
  if (!b) return
  if (!type) throw new ServerError('type_unavailable')
  const result = await plans.commitBinding(db, {
    id: job.server_id,
    groupId: b.groupId,
    typeKey: b.typeKey,
    snapshot: JSON.stringify(type),
    definitionRevision: job.definition_revision,
    installMissing: b.installMissing,
    configRevision: job.expected_config_revision,
  })
  if (!result.rows.length) throw new ServerError('job_configuration_changed')
  await writePolicies(
    db,
    job.server_id,
    type.software.map(
      (s) =>
        b.policies.find((p) => p.software_key === s.software_key) ?? {
          software_key: s.software_key,
          restriction: { kind: 'any' },
          detect_updates: false,
        },
    ),
  )
  await servers.obsoleteSuggestions(db, job.server_id)
  // These observations were verified against the target definition; mark only that closure with the committed revision.
  await plans.advanceSoftwareRevision(db, {
    id: job.server_id,
    softwareKeys: type.software.map((s) => s.software_key),
    configRevision: job.expected_config_revision,
  })
  await plans.advanceRuntimeRevision(db, job.server_id, job.expected_config_revision)
}
async function targetRows(db: Db, id: string) {
  return (await plans.targetRows(db, id)).rows
}

export async function listPlans(db: Db) {
  return (await plans.listPlans(db)).rows
}
export async function retryChangePlan(db: Db, definitions: DefinitionRegistry, id: string) {
  const old = await readChangePlan(db, id)
  if (!['paused', 'blocked', 'partial_failure', 'missed', 'cancelled'].includes(old.state))
    throw new HttpError(409, 'plan_not_ready')
  if (old.targets.some((t) => t.state === 'running')) throw new HttpError(409, 'server_busy')
  const selection = old.request_snapshot.selection,
    ids = old.targets.filter((t) => t.state !== 'succeeded').map((t) => t.server_id)
  if (!ids.length) throw new HttpError(422, 'plan_not_ready')
  const b = selection.binding
  return createChangePlan(db, definitions, {
    kind: old.kind,
    server_ids: ids,
    versions: selection.versions,
    ...(b
      ? {
          group_id: b.groupId,
          type_key: b.typeKey,
          install_missing: b.installMissing,
          software_policies: b.policies,
        }
      : {}),
  })
}
