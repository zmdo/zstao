import { randomUUID } from 'node:crypto'
import { sameSoftware, typeSupportsOs } from '../../shared/definitions.ts'
import { parseDeclaredOs, sameDeclaredOs, type DeclaredOs } from '../../shared/operating-systems.ts'
import { type Db } from '../database/connection.ts'
import { isUnique, transaction } from '../database/transaction.ts'
import { type TypeLease } from '../definitions/model.ts'
import { parsePolicies, restrictLease } from '../definitions/policies.ts'
import { DefinitionRegistry } from '../definitions/registry.ts'
import { type Deps } from '../dependencies.ts'
import { HttpError } from '../errors.ts'
import { type JobRecord } from '../execution/persistence/rows.ts'
import { enqueueOn as enqueue } from '../execution/queue.ts'
import { lockCatalog } from '../groups/persistence/catalog-lock.ts'
import { groupOrNull } from '../groups/service.ts'
import { field, required, text, UUID } from '../input.ts'
import * as keys from '../keys/persistence/repository.ts'
import { canonical } from '../recipes/canonical.ts'
import { notRunning } from './guards.ts'
import { serverRead } from './list.ts'
import type { ServerPatch } from './persistence/inputs.ts'
import { readPolicies, writePolicies } from './persistence/policy-repository.ts'
import * as servers from './persistence/repository.ts'
import { chosenRegion, lookupRegion } from './region.ts'
import { retestAfterEdit, type RetestSnap } from './rules.ts'

type ServerDeps = Pick<Deps, 'db' | 'secrets' | 'definitions' | 'freshnessMs'>

export async function serverDetail(deps: ServerDeps, id: string): Promise<unknown> {
  const server = await serverRead(deps, id)
  if (server === undefined) throw new HttpError(404, 'server_not_found')
  const policies = (await servers.policies(deps.db, id)).rows
  return {
    ...server,
    software_policies: policies,
  }
}

async function selectType(
  definitions: DefinitionRegistry,
  groupId: string | null,
  os: DeclaredOs,
  key?: string,
): Promise<TypeLease> {
  const options = await definitions.options(groupId, os)
  if (!options.available) throw new HttpError(409, 'type_unavailable')
  const selected = key ?? options.default_type_key
  if (!options.types.some((type) => type.key === selected)) throw new HttpError(422, 'type_not_found')
  const lease = await definitions.lease(groupId, selected, os)
  if (lease === undefined) throw new HttpError(409, 'type_unavailable')
  if (!typeSupportsOs(lease.type, os)) {
    lease.release()
    throw new HttpError(422, 'os_type_unsupported')
  }
  return lease
}

function readonlySoftware(body: unknown): void {
  if (field(body, 'install_component_ids') !== undefined)
    throw new HttpError(422, 'required_software_readonly')
}

export async function createServer(deps: ServerDeps, body: unknown): Promise<unknown> {
  const name = required(text(field(body, 'name')), 'name_required')
  const host = required(text(field(body, 'host')), 'host_required')
  const port = portOf(field(body, 'ssh_port'))
  const user = required(text(field(body, 'ssh_user')), 'user_required')
  readonlySoftware(body)
  const method = text(field(body, 'auth_method'))
  if (method !== 'private_key' && method !== 'password') throw new HttpError(422, 'auth_required')
  const os = parseDeclaredOs(field(body, 'declared_os'))
  const groupId = await groupOrNull(deps.db, field(body, 'group_id'))
  const region = await regionOf(host, field(body, 'region'))
  let keyId: string | null = null
  let secret = ''
  if (method === 'private_key') {
    keyId = text(field(body, 'ssh_key_id'))
    if (!UUID.test(keyId)) throw new HttpError(422, 'key_required')
    if ((await keys.findKey(deps.db, keyId)).rows.length === 0) throw new HttpError(422, 'key_not_found')
  } else {
    secret = required(text(field(body, 'secret')), 'password_required')
  }
  const policies = parsePolicies(field(body, 'software_policies'))
  let lease = await selectType(
    deps.definitions,
    groupId,
    os,
    field(body, 'type_key') === undefined ? undefined : text(field(body, 'type_key')),
  )
  try {
    lease = restrictLease(lease, policies)
  } catch (cause) {
    lease.release()
    throw cause
  }
  const id = randomUUID()
  try {
    await transaction(deps.db, async (client) => {
      await lockCatalog(client)
      await groupOrNull(client, groupId)
      const auto = field(body, 'install_required_software') === true && lease.components.length > 0
      await servers.insertServer(client, {
        id,
        name,
        host,
        port,
        user,
        method,
        ciphertext: method === 'password' ? deps.secrets.encrypt(secret) : null,
        keyId,
        groupId,
        region,
        auto,
        os: JSON.stringify(os),
        typeKey: lease.type.key,
        typeSnapshot: JSON.stringify(lease.type),
        typeRevision: lease.signature,
      })
      await servers.insertRuntime(client, id)
      await writePolicies(
        client,
        id,
        lease.components.map(
          (c) =>
            policies.find((p) => p.software_key === c.software_key) ?? {
              software_key: c.software_key,
              restriction: { kind: 'any' },
              detect_updates: false,
            },
        ),
      )
      if (auto || field(body, 'inspect_after_save') === true)
        await enqueue(
          client,
          id,
          'test_connection',
          { configRevision: 1, typeSignature: lease.signature },
          auto,
        )
    })
  } catch (cause) {
    if (isUnique(cause)) throw new HttpError(409, 'server_exists')
    throw cause
  } finally {
    lease.release()
  }
  return serverDetail(deps, id)
}

export async function updateServer(deps: ServerDeps, id: string, body: unknown): Promise<unknown> {
  readonlySoftware(body)
  let lease: TypeLease | undefined
  try {
    await transaction(deps.db, async (client) => {
      await lockCatalog(client)
      const row = (await servers.lockEditable(client, id)).rows[0]
      if (row === undefined) throw new HttpError(404, 'server_not_found')
      const patch: ServerPatch = {}
      const assign = <K extends keyof ServerPatch>(column: K, value: ServerPatch[K]) => {
        patch[column] = value
      }
      const before: RetestSnap = {
        autoInstall: row.install_required_software,
        host: row.host,
        port: row.ssh_port,
        user: row.ssh_user,
        method: row.auth_method,
        keyId: row.ssh_key_id,
        selection: JSON.stringify(row.type_snapshot?.software.map((item) => item.id) ?? []),
        secretWritten: false,
      }
      const after = { ...before }
      const groupId =
        field(body, 'group_id') === undefined
          ? row.group_id
          : await groupOrNull(client, field(body, 'group_id'))
      const choices = await deps.definitions.options(groupId)
      const key =
        field(body, 'type_key') !== undefined
          ? text(field(body, 'type_key'))
          : groupId === row.group_id || choices.types.some((type) => type.key === row.type_key)
            ? row.type_key
            : choices.default_type_key
      const bindingChanged = groupId !== row.group_id || key !== row.type_key
      const os =
        field(body, 'declared_os') === undefined
          ? row.declared_os
          : parseDeclaredOs(field(body, 'declared_os'), row.declared_os)
      const osChanged = !sameDeclaredOs(os, row.declared_os)
      if (bindingChanged) throw new HttpError(409, 'type_change_requires_preflight')
      lease =
        bindingChanged || osChanged
          ? await selectType(deps.definitions, groupId, os, key)
          : await deps.definitions.lease(groupId, key, os)
      const oldPolicies = await readPolicies(client, id)
      const policies =
        field(body, 'software_policies') === undefined
          ? oldPolicies
          : parsePolicies(field(body, 'software_policies'))
      if (lease) lease = restrictLease(lease, policies)
      const ranges = (items: typeof policies) =>
        items
          .map((p) => ({ key: p.software_key, restriction: p.restriction }))
          .sort((a, b) => a.key.localeCompare(b.key))
      const rangeChanged = canonical(ranges(oldPolicies)) !== canonical(ranges(policies))
      const prior =
        row.type_snapshot ?? deps.definitions.defaultOptions().types.find((type) => type.key === row.type_key)
      if (field(body, 'name') !== undefined)
        assign('name', required(text(field(body, 'name')), 'name_required'))
      if (field(body, 'host') !== undefined) {
        after.host = required(text(field(body, 'host')), 'host_required')
        assign('host', after.host)
      }
      if (field(body, 'ssh_port') !== undefined) {
        after.port = portOf(field(body, 'ssh_port'))
        assign('ssh_port', after.port)
      }
      if (field(body, 'ssh_user') !== undefined) {
        after.user = required(text(field(body, 'ssh_user')), 'user_required')
        assign('ssh_user', after.user)
      }
      if (field(body, 'region') !== undefined)
        assign('region', await regionOf(after.host, field(body, 'region')))
      after.autoInstall =
        field(body, 'install_required_software') === undefined
          ? row.install_required_software
          : field(body, 'install_required_software') === true
      if (lease !== undefined) {
        if (lease.components.length === 0) after.autoInstall = false
        after.selection = JSON.stringify(lease.components.map((item) => item.id))
        // Auto install already enabled on an unchanged type must not block an ordinary basic edit.
        if (after.autoInstall && (osChanged || !row.install_required_software) && prior !== undefined && !sameSoftware(prior, lease.type))
          throw new HttpError(409, 'type_change_requires_preflight')
        assign('type_key', key)
        assign('type_snapshot', JSON.stringify(lease.type))
        assign('type_revision', lease.signature)
      } else if (after.autoInstall && !row.install_required_software)
        throw new HttpError(409, 'type_unavailable')
      assign('install_required_software', after.autoInstall)
      if (osChanged) assign('declared_os', JSON.stringify(os))
      if (bindingChanged) assign('group_id', groupId)
      if (
        field(body, 'auth_method') !== undefined ||
        field(body, 'ssh_key_id') !== undefined ||
        field(body, 'secret') !== undefined
      ) {
        const method =
          field(body, 'auth_method') === undefined ? row.auth_method : text(field(body, 'auth_method'))
        if (method === 'private_key') {
          const keyId =
            field(body, 'ssh_key_id') === undefined ? (row.ssh_key_id ?? '') : text(field(body, 'ssh_key_id'))
          if (!UUID.test(keyId)) throw new HttpError(422, 'key_required')
          if ((await keys.findKey(client, keyId)).rows.length === 0) throw new HttpError(422, 'key_not_found')
          after.method = 'private_key'
          after.keyId = keyId
          assign('auth_method', 'private_key')
          assign('ssh_key_id', keyId)
          assign('secret_ciphertext', null)
        } else if (method === 'password') {
          const secret = text(field(body, 'secret'))
          if (secret === '' && row.auth_method !== 'password') throw new HttpError(422, 'password_required')
          after.method = 'password'
          after.keyId = null
          after.secretWritten = secret !== ''
          assign('auth_method', 'password')
          assign('ssh_key_id', null)
          if (secret !== '') assign('secret_ciphertext', deps.secrets.encrypt(secret))
        } else throw new HttpError(422, 'auth_required')
      }
      const definitionChanged = lease !== undefined && lease.signature !== row.type_revision
      const critical =
        rangeChanged ||
        osChanged ||
        bindingChanged ||
        definitionChanged ||
        before.host !== after.host ||
        before.port !== after.port ||
        before.user !== after.user ||
        before.method !== after.method ||
        before.keyId !== after.keyId ||
        before.autoInstall !== after.autoInstall ||
        before.selection !== after.selection ||
        after.secretWritten
      if (critical) await notRunning(client, id)
      const revision = critical ? String(BigInt(row.config_revision) + 1n) : row.config_revision
      if (critical) {
        assign('config_revision', revision)
        await servers.obsoleteSuggestions(client, id)
      }
      await servers.updateServer(client, id, patch)
      if (lease)
        await writePolicies(
          client,
          id,
          lease.components.map(
            (c) =>
              policies.find((p) => p.software_key === c.software_key) ?? {
                software_key: c.software_key,
                restriction: { kind: 'any' },
                detect_updates: false,
              },
          ),
        )
      if (critical) await servers.resetConnection(client, id)
      if (
        rangeChanged ||
        osChanged ||
        retestAfterEdit(before, after) ||
        field(body, 'inspect_after_save') === true
      )
        await enqueue(
          client,
          id,
          'test_connection',
          { configRevision: revision, typeSignature: lease?.signature ?? '' },
          after.autoInstall,
        )
    })
  } catch (cause) {
    if (isUnique(cause)) throw new HttpError(409, 'server_exists')
    throw cause
  } finally {
    lease?.release()
  }
  return serverDetail(deps, id)
}

export async function enqueueExisting(
  deps: ServerDeps,
  id: string,
  action: string,
  source: 'manual' | 'scheduled' = 'manual',
): Promise<JobRecord> {
  let lease: TypeLease | undefined
  try {
    return await transaction(deps.db, async (client) => {
      await lockCatalog(client)
      const row = (await servers.lockBinding(client, id)).rows[0]
      if (row === undefined) throw new HttpError(404, 'server_not_found')
      lease = await deps.definitions.lease(row.group_id, row.type_key, row.declared_os)
      if (lease) lease = restrictLease(lease, await readPolicies(client, id))
      if (action === 'install_components' && lease === undefined) throw new HttpError(409, 'type_unavailable')
      if (action === 'install_components' && lease?.components.length === 0)
        throw new HttpError(422, 'no_required_software')
      const job = await enqueue(client, id, action, {
        configRevision: row.config_revision,
        typeSignature: lease?.signature ?? '',
      }, false, source)
      return job
    })
  } finally {
    lease?.release()
  }
}

export async function deleteServer(db: Db, id: string): Promise<void> {
  await transaction(db, async (client) => {
    if ((await servers.lockServer(client, id)).rows.length === 0) throw new HttpError(404, 'server_not_found')
    await notRunning(client, id)
    await servers.cancelQueuedJobs(client, id)
    await servers.cancelPendingPlans(client, id)
    await servers.cancelPendingTargets(client, id)
    await servers.deleteServer(client, id)
  })
}

export function omitSecrets(row: Record<string, unknown>): Record<string, unknown> {
  const visible = { ...row }
  for (const key of HIDDEN) delete visible[key]
  return visible
}


async function regionOf(host: string, value: unknown): Promise<string> {
  const written = typeof value === 'string' ? value : ''
  return (written.trim() === '' ? await lookupRegion(host) : chosenRegion(host, written, null)) ?? ''
}

function portOf(value: unknown): number {
  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(422, 'port_invalid')
  return port
}

const HIDDEN = ['secret_ciphertext', 'secret', 'password', 'private_key']
