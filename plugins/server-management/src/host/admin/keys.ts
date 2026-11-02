import * as queries from './persistence/repository.ts'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createKey } from '../keys/service.ts'
import { keyFingerprint } from '../remote/ssh.ts'
import type { AdminDeps } from './model.ts'
import { AdminError } from './model.ts'
const { utils } = createRequire(import.meta.url)('ssh2') as typeof import('ssh2')
export function generateKey() {
  return utils.generateKeyPairSync('ed25519')
}
export function publicKey(privateKey: string): string {
  const parsed = utils.parseKey(privateKey)
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (!key || key instanceof Error) throw new AdminError('key_invalid')
  return `${key.type} ${key.getPublicSSH().toString('base64')}`
}
export async function generateStoredKey(deps: AdminDeps, name: string) {
  const pair = generateKey()
  return createKey(deps, { name, secret: pair.private })
}
export async function exportKeyPage(deps: AdminDeps, keyId: string) {
  const row = (await queries.keyFingerprintRow<{ fingerprint: string }>(deps.db, [keyId])).rows[0]
  if (!row) throw new AdminError('key_not_found')
  const id = randomUUID()
  await queries.insertKeyDownload(deps.db, [id, keyId, row.fingerprint])
  return {
    key_id: keyId,
    fingerprint: row.fingerprint,
    url: `/console-api/server-admin-downloads/${id}`,
    expires_in_seconds: 600,
    requires_human_confirmation: true,
  }
}
export { keyFingerprint }
