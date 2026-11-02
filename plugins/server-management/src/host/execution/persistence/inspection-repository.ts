import type { Db } from '../../database/connection.ts'

export async function dueInspects(db: Db, intervalSeconds: number): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `select s.id from servers s join server_runtime r on r.server_id=s.id
    where r.connection_state='online' and (r.connection_checked_at is null or r.connection_checked_at < now()-make_interval(secs=>$1))
    and not exists(select 1 from server_jobs j where j.server_id=s.id and j.purpose='inspect' and j.state in ('queued','claimed','running','recovering'))`,
    [intervalSeconds],
  )
  return result.rows.map((row) => row.id)
}
