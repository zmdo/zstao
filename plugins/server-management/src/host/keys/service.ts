import { randomUUID } from 'node:crypto'
import { type Db } from '../database/connection.ts'
import { isUnique } from '../database/transaction.ts'
import { type Deps } from '../dependencies.ts'
import { HttpError } from '../errors.ts'
import { field, required, text } from '../input.ts'
import { keyFingerprint, SshError } from '../remote/ssh.ts'
import { keyInUse } from '../servers/rules.ts'
import * as keys from './persistence/repository.ts'

export async function listKeys(db: Db): Promise<unknown[]> {
  return (await keys.listKeys(db)).rows
}

export async function createKey(deps: Pick<Deps, 'db' | 'secrets'>, body: unknown): Promise<unknown> {
  const name = required(text(field(body, 'name')), 'name_required')
  const secret = required(text(field(body, 'secret')), 'private_key_required')
  let fingerprint: string
  try {
    fingerprint = keyFingerprint(secret)
  } catch (cause) {
    throw new HttpError(
      422,
      cause instanceof SshError ? cause.code : 'key_invalid',
      cause instanceof SshError ? cause.params : {},
      { cause },
    )
  }
  try {
    const result = await keys.insertKey(deps.db, {
      id: randomUUID(),
      name,
      fingerprint,
      ciphertext: deps.secrets.encrypt(secret),
    })
    return { ...result.rows[0], server_count: 0 }
  } catch (cause) {
    if (isUnique(cause)) throw new HttpError(409, 'key_exists')
    throw cause
  }
}

export async function deleteKey(db: Db, id: string): Promise<void> {
  const count = Number((await keys.referenceCount(db, id)).rows[0]?.count ?? 0)
  if (keyInUse(count)) throw new HttpError(409, 'key_in_use')
  if ((await keys.deleteKey(db, id)).rows.length === 0) throw new HttpError(404, 'key_not_found')
}
