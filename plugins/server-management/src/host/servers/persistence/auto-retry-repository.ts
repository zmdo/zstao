import type { Db } from '../../database/connection.ts'

const ACTIVE_TEST = "state in ('queued','claimed','running','recovering')"
const NEXT_DELAY =
  'case auto_retry_attempts when 0 then 60 when 1 then 300 when 2 then 900 else 1800 end'

/** Atomically claims one automatic reconnect attempt and sets the next backoff window. */
export async function claimAutoRetry(db: Db, serverId: string): Promise<boolean> {
  const result = await db.query<{ server_id: string }>(
    `update server_runtime r set
       auto_retry_at = now() + make_interval(secs => ${NEXT_DELAY}),
       auto_retry_attempts = auto_retry_attempts + 1
     where r.server_id=$1 and r.connection_state='offline'
       and (r.auto_retry_at is null or r.auto_retry_at <= now())
       and not exists (
         select 1 from server_jobs j
         where j.server_id=$1 and j.purpose='inspect' and ${ACTIVE_TEST}
           and j.request_snapshot->>'action'='test_connection'
       )
     returning r.server_id`,
    [serverId],
  )
  return result.rows.length > 0
}

export async function releaseAutoRetry(db: Db, serverId: string): Promise<void> {
  await db.query<never>('update server_runtime set auto_retry_at=now() where server_id=$1', [serverId])
}

export async function resetAutoRetry(db: Db, serverId: string): Promise<void> {
  await db.query<never>(
    'update server_runtime set auto_retry_at=null, auto_retry_attempts=0 where server_id=$1',
    [serverId],
  )
}
