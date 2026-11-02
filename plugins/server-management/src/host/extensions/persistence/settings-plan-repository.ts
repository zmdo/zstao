import type { Db } from '../../database/connection.ts'
import type { Json } from '../../../shared/contracts/common.ts'

export interface SettingProposalRow {
  id: string
  server_id: string
  owner: string
  section_key: string
  value: Json
  expected_revision: string
  digest: string
  state: 'pending' | 'applied' | 'cancelled' | 'expired'
  expires_at: Date
}

export function insertProposal(
  db: Db,
  input: {
    id: string
    serverId: string
    owner: string
    section: string
    value: Json
    expectedRevision: string
    digest: string
    expiresAt: Date
  },
) {
  return db.query<{ id: string; digest: string; expires_at: Date }>(
    `insert into server_extension_setting_proposals
       (id,server_id,owner,section_key,value,expected_revision,digest,expires_at)
     values($1,$2,$3,$4,$5,$6,$7,$8)
     returning id,digest,expires_at`,
    [
      input.id,
      input.serverId,
      input.owner,
      input.section,
      JSON.stringify(input.value),
      input.expectedRevision,
      input.digest,
      input.expiresAt,
    ],
  )
}

export function lockProposal(db: Db, id: string) {
  return db.query<SettingProposalRow>(
    'select * from server_extension_setting_proposals where id=$1 for update',
    [id],
  )
}

export function markApplied(db: Db, id: string, revision: string) {
  return db.query<never>(
    `update server_extension_setting_proposals
     set state='applied',applied_revision=$2,applied_at=now() where id=$1`,
    [id, revision],
  )
}
