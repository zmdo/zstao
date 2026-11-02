import * as queries from './persistence/repository.ts'
import type { Db } from '../database/connection.ts'
import { listGroups, createGroup, renameGroup, deleteGroup } from '../groups/service.ts'
import { listKeys, deleteKey } from '../keys/service.ts'
import { updateServer, deleteServer } from '../servers/service.ts'
import { getHarnessServer } from '../harness/service.ts'
import {
  createChangePlan,
  readChangePlan,
  confirmChangePlan,
  controlPlan,
} from '../changes/service.ts'
import { detectUpdates, listSuggestions } from '../upgrades/service.ts'
import { mutate } from './approval.ts'
import { serverSnapshot, groupSnapshot, keySnapshot } from './persistence/repository.ts'
import { generateStoredKey, exportKeyPage } from './keys.ts'
import { rotateKey } from './rotation.ts'
import { auditAction } from './retention.ts'
import { ADMIN_ACTIONS, validateAdminInput, type AdminTool } from './contracts.ts'
import { draftResult, planResult } from './guidance.ts'
import {
  AdminError,
  fields,
  object,
  text,
  uuid,
  revision,
  instant,
  type AdminDeps,
  type AdminContext,
  type Input,
} from './model.ts'

export { ADMIN_ACTIONS, type AdminTool } from './contracts.ts'
export async function executeAdmin(
  deps: AdminDeps,
  ctx: AdminContext,
  tool: AdminTool,
  action: string,
  input: Input,
): Promise<unknown> {
  if (!ctx.agent || ctx.signal.aborted) throw new AdminError('unauthorized')
  if (!(ADMIN_ACTIONS[tool] as readonly string[]).includes(action))
    throw new AdminError('invalid_action')
  validateAdminInput(tool, action, input)
  switch (tool) {
    case 'platform_server_group_admin':
      return groupAction(deps, ctx, action, input)
    case 'platform_server_key_admin':
      return keyAction(deps, ctx, action, input)
    case 'platform_server_upgrade_admin':
      return planAction(deps, ctx, action, input)
    case 'platform_server_admin':
      return serverAction(deps, ctx, action, input)
    case 'platform_audit_admin':
      return auditAction(deps, ctx, action, input)
  }
}
async function groupAction(deps: AdminDeps, ctx: AdminContext, action: string, input: Input) {
  if (action === 'types')
    return deps.definitions.options(input.group_id === null ? null : uuid(input.group_id))

  if (action === 'list') return listGroups(deps.db, deps.definitions)
  const id = action === 'create' ? 'new' : uuid(input.group_id)
  const name = action === 'create' || action === 'rename' ? text(input.name, 80) : undefined
  const read =
    action === 'create' ? async () => null : (db: Db, lock: boolean) => groupSnapshot(db, id, lock)
  return mutate(
    deps,
    ctx,
    'platform_server_group_admin',
    action,
    id,
    read,
    async (db) => {
      if (action === 'create') return createGroup(db, deps.definitions, { name })
      if (action === 'rename') return renameGroup(db, deps.definitions, id, { name })
      await deleteGroup(db, id)
      return { deleted: id }
    },
    input,
  )
}
async function keyAction(deps: AdminDeps, ctx: AdminContext, action: string, input: Input) {
  if (action === 'rotate') return rotateKey(deps, ctx, input)
  if (action === 'list') return listKeys(deps.db)
  const id = action === 'create' ? 'new' : uuid(input.key_id)
  if (action === 'reveal') return exportKeyPage(deps, id)
  const name = action === 'create' ? text(input.name, 80) : undefined
  return mutate(
    deps,
    ctx,
    'platform_server_key_admin',
    action,
    id,
    action === 'create' ? async () => null : (db, lock) => keySnapshot(db, id, lock),
    async (db) => {
      if (action === 'create') return generateStoredKey({ ...deps, db }, name!)
      await deleteKey(db, id)
      return { deleted: id }
    },
    input,
  )
}
async function managedId(deps: AdminDeps, input: Input) {
  return (await getHarnessServer(deps, text(input.server))).id
}
async function serverAction(deps: AdminDeps, ctx: AdminContext, action: string, input: Input) {
  const id = await managedId(deps, input),
    expected = revision(input.expected_config_revision)
  const patch = action === 'update' ? object(input.patch) : {}
  if (action === 'update') {
    fields(patch, [
      'name',
      'region',
      'declared_os',
      'install_required_software',
      'host',
      'ssh_port',
      'ssh_user',
      'ssh_key_id',
    ])
    if (!Object.keys(patch).length) throw new AdminError('invalid_request')
    for (const name of ['name', 'region', 'host', 'ssh_user'])
      if (patch[name] !== undefined) text(patch[name], name === 'host' ? 255 : 80)
    if (patch.ssh_key_id !== undefined) uuid(patch.ssh_key_id)
    if (
      patch.ssh_port !== undefined &&
      (!Number.isInteger(patch.ssh_port) ||
        Number(patch.ssh_port) < 1 ||
        Number(patch.ssh_port) > 65535)
    )
      throw new AdminError('invalid_request')
    if (
      patch.install_required_software !== undefined &&
      typeof patch.install_required_software !== 'boolean'
    )
      throw new AdminError('invalid_request')
  }
  if (action === 'rebind') {
    if (input.target_group !== null) uuid(input.target_group)
    if (typeof input.install_missing !== 'boolean' || !Array.isArray(input.software_policies))
      throw new AdminError('invalid_request')
  }
  return mutate(
    deps,
    ctx,
    'platform_server_admin',
    action,
    id,
    async (db, lock) => {
      const row = await serverSnapshot(db, id, lock)
      if (row.config_revision !== expected) throw new AdminError('server_revision_conflict')
      return patch.ssh_key_id === undefined
        ? row
        : { ...row, requested_key: await keySnapshot(db, uuid(patch.ssh_key_id), lock) }
    },
    async (db) => {
      if (action === 'delete') {
        await deleteServer(db, id)
        return { deleted: id }
      }
      if (action === 'rebind') {
        const row = await serverSnapshot(db, id)
        const planId = await createChangePlan(db, deps.definitions, {
          kind: 'move',
          server_ids: [id],
          group_id: input.target_group,
          type_key: input.target_type ?? row.type_key,
          install_missing: input.install_missing,
          software_policies: input.software_policies,
        })
        return draftResult(planId, 'move', ctx.authorization?.source === 'full-access')
      }
      const before = await serverSnapshot(db, id)
      const connectionChanged = ['host', 'ssh_port', 'ssh_user', 'ssh_key_id'].some(
        (key) => patch[key] !== undefined && patch[key] !== before[key],
      )
      await updateServer({ ...deps, db }, id, {
        ...patch,
        ...(patch.ssh_key_id === undefined ? {} : { auth_method: 'private_key' }),
        ...(connectionChanged ? { inspect_after_save: true } : {}),
      })
      const row = await serverSnapshot(db, id)
      return {
        server: row,
        configuration_saved: true,
        connection_test: (await queries.latestConnectionJob(db, [id])).rows[0] ?? null,
      }
    },
    input,
  )
}
async function planAction(deps: AdminDeps, ctx: AdminContext, action: string, input: Input) {
  if (action === 'check' || action === 'suggestions') {
    const id = await managedId(deps, input)
    const page = input.page ?? 1
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1)
      throw new AdminError('invalid_request', { field: 'input.page', hint: 'Use an integer >= 1.' })
    if (action === 'check') await detectUpdates(deps, { server_ids: [id] })
    return {
      queued: action === 'check',
      guidance:
        'Detection is asynchronous. Inspect checks.last_check_at/check_error/check_snapshot and suggestion validity before selecting exact versions. Poll suggestions after a short delay; check queues new work. Use page to read more items when total > page_size.',
      next_step: {
        tool: 'platform_server_upgrade_admin',
        arguments: { action: 'suggestions', input: { server: id } },
      },
      ...(await listSuggestions(deps, {
        page,
        query: '',
        decision: '',
        server: id,
        group: null,
        type: null,
        software: null,
        connection: null,
        current: null,
        target: null,
      })),
    }
  }
  if (action === 'plan') {
    const id = await managedId(deps, input),
      expected = revision(input.expected_config_revision)
    object(input.versions)
    return mutate(
      deps,
      ctx,
      'platform_server_upgrade_admin',
      action,
      id,
      async (db, lock) => {
        const row = await serverSnapshot(db, id, lock)
        if (row.config_revision !== expected) throw new AdminError('server_revision_conflict')
        return row
      },
      async (db) =>
        draftResult(
          await createChangePlan(db, deps.definitions, {
            kind: 'upgrade',
            server_ids: [id],
            versions: input.versions,
          }),
          'upgrade',
          ctx.authorization?.source === 'full-access',
        ),
      input,
    )
  }
  const id = uuid(input.plan_id)
  const read = async (db: Db, lock: boolean) => {
    if (lock) await queries.lockChangePlan(db, [id])
    const plan = await readChangePlan(db, id)
    if (plan.targets.length !== 1) throw new AdminError('single_server_required')
    return plan
  }
  if (action === 'show') return planResult(await read(deps.db, false))
  if (action === 'apply') {
    text(input.review_digest, 64)
    text(input.revision)
    instant(input.start)
    instant(input.end)
    text(input.timezone)
  }
  return mutate(
    deps,
    ctx,
    'platform_server_upgrade_admin',
    action,
    id,
    read,
    async (db) => {
      if (action === 'cancel') await controlPlan(db, id, 'cancel')
      else
        await confirmChangePlan(db, id, {
          ...input,
          concurrency: 1,
          ack_replacement: true,
          ack_major: true,
          ack_service_impact: true,
        })
      return planResult(await readChangePlan(db, id))
    },
    input,
  )
}
