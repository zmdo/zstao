import { type Db } from '../database/connection.ts'
import { HttpError } from '../errors.ts'
import * as servers from './persistence/repository.ts'

export async function notRunning(db: Db, id: string): Promise<void> {
  if ((await servers.activeRotations(db, id)).rows.length) throw new HttpError(409, 'server_busy')
  if ((await servers.activeJobs(db, id)).rows.length > 0) throw new HttpError(409, 'server_busy')
}
