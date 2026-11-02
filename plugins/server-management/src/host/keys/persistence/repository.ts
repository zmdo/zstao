import { type Db } from '../../database/connection.ts'
import type { InsertKeyInput } from './inputs.ts'
import type { CreatedKeyRow, KeyListRow, SecretForConnectionRow } from './rows.ts'

export function findKey(db: Db, id: string) {
  return db.query<{ id: string }>('select id from ssh_keys where id = $1', [id])
}

export function listKeys(db: Db) {
  return db.query<KeyListRow>(
    `select k.id, k.name, k.fingerprint, k.created_at, (select count(*)::int from servers s where s.ssh_key_id = k.id) as server_count from ssh_keys k order by k.name`,
  )
}

export function insertKey(db: Db, { id, name, fingerprint, ciphertext }: InsertKeyInput) {
  return db.query<CreatedKeyRow>(
    'insert into ssh_keys (id, name, fingerprint, secret_ciphertext) values ($1, $2, $3, $4) returning id, name, fingerprint, created_at',
    [id, name, fingerprint, ciphertext],
  )
}

export function referenceCount(db: Db, id: string) {
  return db.query<{ count: number }>(`select (select count(*) from servers where ssh_key_id=$1) +
    (select count(*) from server_key_rotations where (old_key_id=$1 or new_key_id=$1) and state in ('prepared','deployed','switched','unknown')) as count`, [id])
}

export function deleteKey(db: Db, id: string) {
  return db.query<{ id: string }>('delete from ssh_keys where id = $1 returning id', [id])
}

export function secretForConnection(db: Db, id: string) {
  return db.query<SecretForConnectionRow>('select secret_ciphertext from ssh_keys where id=$1', [id])
}
