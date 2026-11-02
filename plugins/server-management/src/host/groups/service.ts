import { randomUUID } from 'node:crypto'
import { VACANT_TYPE } from '../../shared/definitions.ts'
import { osVerification } from '../../shared/operating-systems.ts'
import { type Db } from '../database/connection.ts'
import { isUnique, transaction } from '../database/transaction.ts'
import { DefinitionRegistry } from '../definitions/registry.ts'
import { HttpError } from '../errors.ts'
import { field, required, text, UUID } from '../input.ts'
import { notRunning } from '../servers/guards.ts'
import { lockCatalog } from './persistence/catalog-lock.ts'
import * as groups from './persistence/repository.ts'

export async function listGroups(db: Db, definitions: DefinitionRegistry): Promise<unknown[]> {
  const result = await groups.listGroups(db)
  return result.rows.map((row) => definitions.view(row))
}

export async function createGroup(db: Db, definitions: DefinitionRegistry, body: unknown): Promise<unknown> {
  const name = required(text(field(body, 'name')), 'group_name_required')
  if (['未分组', '全部服务器', 'ungrouped', 'all servers'].includes(name.toLowerCase()))
    throw new HttpError(422, 'group_name_reserved')
  if (
    ['kind', 'plugin_id', 'group_key', 'types', 'definition', 'name_i18n'].some(
      (key) => field(body, key) !== undefined,
    )
  )
    throw new HttpError(422, 'group_source_readonly')
  try {
    const result = await groups.insertGroup(db, randomUUID(), name)
    return definitions.view({ ...result.rows[0]!, server_count: 0 })
  } catch (cause) {
    if (isUnique(cause)) throw new HttpError(409, 'group_exists')
    throw cause
  }
}

export async function renameGroup(db: Db, definitions: DefinitionRegistry, id: string, body: unknown): Promise<unknown> {
  const name = required(text(field(body, 'name')), 'group_name_required')
  if (['未分组', '全部服务器', 'ungrouped', 'all servers'].includes(name.toLowerCase()))
    throw new HttpError(422, 'group_name_reserved')
  try {
    const result = await transaction(db, async (client) => {
      const row = (await groups.lockGroup(client, id)).rows[0]
      if (row === undefined) throw new HttpError(404, 'group_not_found')
      if (row.kind === 'system') throw new HttpError(403, 'system_group_protected')
      return (await groups.renameGroup(client, id, name)).rows[0]
    })
    return definitions.view(result!)
  } catch (cause) {
    if (isUnique(cause)) throw new HttpError(409, 'group_exists')
    throw cause
  }
}

export async function deleteGroup(db: Db, id: string): Promise<void> {
  await transaction(db, async (client) => {
    await lockCatalog(client)
    const row = (await groups.lockGroup(client, id)).rows[0]
    if (row === undefined) throw new HttpError(404, 'group_not_found')
    if (row.kind === 'system') throw new HttpError(403, 'system_group_protected')
    const servers = await groups.lockMembers(client, id)
    for (const server of servers.rows) {
      if (server.type_key !== VACANT_TYPE)
        throw new HttpError(409, 'group_not_empty')
      await notRunning(client, server.id)
      if (
        String(server.config_revision) === String(server.observed_config_revision) &&
        osVerification(server.declared_os, server.detected_os, server.os_probe_state) === 'mismatch'
      )
        throw new HttpError(409, 'os_mismatch')
    }
    await groups.unbindMembers(client, id)
    await groups.deleteGroup(client, id)
  })
}

export async function groupOrNull(db: Db, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null
  const id = text(value)
  if (!UUID.test(id)) throw new HttpError(422, 'group_not_found')
  if ((await groups.findGroup(db, id)).rows.length === 0) throw new HttpError(422, 'group_not_found')
  return id
}
