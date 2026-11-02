import { transaction } from '../database/transaction.ts'
import { HttpError } from '../errors.ts'
import type { ServerExtensionRegistry } from './registry.ts'
import { readSettings, saveSettings, lockSettingsServer, type StoredExtensionSettings } from './persistence/settings-repository.ts'
import type { Db } from '../database/connection.ts'
import type { Json } from '../../shared/contracts/common.ts'

export async function extensionSettings(
  db: Db,
  serverId: string,
  owner: string,
  section: string,
): Promise<StoredExtensionSettings | undefined> {
  return (await readSettings(db, serverId, owner, section)).rows[0]
}

export async function saveExtensionSettings(
  db: Db,
  input: { serverId: string; owner: string; section: string; value: Json; expectedRevision: string },
  extensions?: ServerExtensionRegistry,
): Promise<StoredExtensionSettings | undefined> {
  return transaction(db, async (client) => {
    const server = (await lockSettingsServer(client, input.serverId)).rows[0]
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    const current = (await readSettings(client, input.serverId, input.owner, input.section)).rows[0]
    if ((current?.revision ?? '0') !== input.expectedRevision) return undefined
    const found = extensions?.settings(server, `${input.owner}/${input.section}`)
    if (found?.entry.affectsExecution) throw new HttpError(422, 'extension_settings_requires_plan')
    const value = found?.runtime.validate(input.value) ?? input.value
    const saved = (await saveSettings(client, { ...input, value })).rows[0]
    if (found !== undefined) extensions!.assertCurrent(found.entry)
    return saved
  })
}
