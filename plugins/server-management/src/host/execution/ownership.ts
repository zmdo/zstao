import { ServerError } from '../../shared/errors.ts'
import type { Db, DbClient } from '../database/connection.ts'
import { transaction } from '../database/transaction.ts'
import { LEASE_SECONDS } from './model.ts'
import * as repository from './persistence/repository.ts'
import type { JobRecord } from './persistence/rows.ts'

export async function heartbeat(db: Db, job: JobRecord): Promise<boolean> {
  const result = await repository.heartbeat(db, {
    id: job.id,
    workerId: job.worker_id,
    fence: job.fence,
    leaseSeconds: LEASE_SECONDS,
  })
  return result.rows.length > 0
}

export async function owned<T>(db: Db, job: JobRecord, run: (client: DbClient) => Promise<T>): Promise<T> {
  return transaction(db, async (client) => {
    const locked = await repository.lockOwnership(client, {
      id: job.id,
      workerId: job.worker_id,
      fence: job.fence,
    })
    if (!locked.rows.length) throw new ServerError('job_lease_lost')
    await repository.lockServer(client, job.server_id)
    const value = await run(client)
    return value
  })
}

export async function phase(db: Db, job: JobRecord, next: string): Promise<void> {
  await owned(db, job, async (client) => {
    await repository.setPhase(client, job.id, next)
  })
  job.phase = next
}

export async function recovering(
  db: Db,
  job: JobRecord,
  message: string,
  remoteState: 'running' | 'unknown' = 'unknown',
): Promise<void> {
  await owned(db, job, async (client) => {
    await repository.recovering(client, {
      id: job.id,
      message: message.slice(-4000),
      remoteState,
    })
  })
}
