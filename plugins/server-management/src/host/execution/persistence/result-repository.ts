import { type Db } from '../../database/connection.ts'
import type { SaveStepInput } from './inputs.ts'

export function markDisconnected(db: Db, serverId: string, error: string) {
  return db.query<never>(
    "update server_runtime set connection_state='offline',connection_checked_at=now(),connection_error=$2,auto_retry_at=now() where server_id=$1",
    [serverId, error],
  )
}

export function saveStep(
  db: Db,
  { id, jobId, ordinal, software, state, after, changes, error, phase }: SaveStepInput,
) {
  return db.query<never>(
    `insert into server_job_steps(id,job_id,ordinal,software_key,phase,state,after_snapshot,changes,error,finished_at)
      values($1,$2,$3,$4,$9,$5,$6,$7,$8,now()) on conflict(job_id,ordinal) do update set state=excluded.state,after_snapshot=excluded.after_snapshot,changes=excluded.changes,error=excluded.error,finished_at=excluded.finished_at`,
    [id, jobId, ordinal, software, state, after, changes, error, phase],
  )
}
