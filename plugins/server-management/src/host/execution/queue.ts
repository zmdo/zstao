import { randomUUID } from 'node:crypto'
import { ServerError } from '../../shared/errors.ts'
import type { Db } from '../database/connection.ts'
import { transaction } from '../database/transaction.ts'
import { LEASE_SECONDS } from './model.ts'
import * as repository from './persistence/repository.ts'
import type { JobRecord } from './persistence/rows.ts'

export async function enqueue(
  db: Db,
  serverId: string,
  action: string,
  expected?: { configRevision: string | number; typeSignature: string },
  prepare = false,
  source: 'manual' | 'scheduled' = 'scheduled',
): Promise<JobRecord> {
  return transaction(db, async (client) => {
    const result = await enqueueOn(client, serverId, action, expected, prepare, source)
    return result
  })
}

/** Call while the server row is locked; works inside registration/edit transactions. */
export async function enqueueOn(
  db: Db,
  serverId: string,
  action: string,
  expected?: { configRevision: string | number; typeSignature: string },
  prepare = false,
  source: 'manual' | 'scheduled' = 'scheduled',
): Promise<JobRecord> {
  const server = (await repository.lockServerRevision(db, serverId)).rows[0]
  if (!server) throw new ServerError('server_not_found')
  const request = { action, prepare: prepare || action === 'install_components', source }
  const existing = (
    await repository.matchingInspection(db, {
      serverId,
      configRevision: expected?.configRevision ?? server.config_revision,
      snapshot: JSON.stringify(request),
    })
  ).rows[0]
  if (existing) return existing
  const id = randomUUID()
  return (
    await repository.insertInspection(db, {
      id,
      serverId,
      configRevision: expected?.configRevision ?? server.config_revision,
      environmentRevision: server.environment_revision,
      definitionRevision: expected?.typeSignature ?? '',
      operationId: randomUUID(),
      snapshot: JSON.stringify(request),
    })
  ).rows[0]!
}

export async function claimNext(db: Db, workerId: string): Promise<JobRecord | undefined> {
  return transaction(db, async (client) => {
    const found = (await repository.nextCandidate(client)).rows[0]
    if (!found) {
      return
    }
    if (!(await repository.tryLockServer(client, found.server_id)).rows.length) {
      return
    }
    if (found.state === 'queued' && (await repository.activeJobs(client, found.server_id)).rows.length) {
      return
    }
    if (found.state === 'queued' && found.purpose === 'apply_plan') {
      const plan = (await repository.lockTargetPlan(client, found.target_id)).rows[0]
      const count = (await repository.activePlanCount(client, plan?.id)).rows[0]!
      if (
        !plan ||
        !['scheduled', 'running'].includes(plan.state) ||
        plan.window_start.getTime() > Date.now() ||
        plan.window_end.getTime() <= Date.now() ||
        Number(count.count) >= plan.concurrency
      ) {
        return
      }
    }
    const state = found.state === 'queued' ? 'running' : 'recovering'
    const claimed = (
      await repository.claim(client, {
        id: found.id,
        state,
        workerId,
        leaseSeconds: LEASE_SECONDS,
      })
    ).rows[0]!
    return claimed
  })
}
