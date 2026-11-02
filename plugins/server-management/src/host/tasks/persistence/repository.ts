import { type Db } from '../../database/connection.ts'
import { type JobRecord } from '../../execution/persistence/rows.ts'

export function readJob(db: Db, id: string) {
  return db.query<JobRecord>('select * from server_jobs where id = $1', [id])
}
