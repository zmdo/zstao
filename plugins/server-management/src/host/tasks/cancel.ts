import { transaction } from '../database/transaction.ts'
import type { Db } from '../database/connection.ts'
import { HttpError } from '../errors.ts'
import {
  cancelActive,
  cancelPlan,
  cancelPlanJobs,
  cancelPlanTargets,
  cancelTargetAndPlan,
} from './persistence/cancel-repository.ts'

/**
 * Cancel a queued/running job. For apply_plan jobs, cancel the owning target and plan too;
 * a cancelled plan cannot be picked up again by the scheduler.
 */
export async function cancelJob(db: Db, id: string): Promise<void> {
  await transaction(db, async (client) => {
    const job = (await cancelActive(client, id)).rows[0]
    if (!job) throw new HttpError(409, 'job_not_cancellable')
    if (job.purpose !== 'apply_plan' || job.target_id === null) return
    const target = (await cancelTargetAndPlan(client, job.target_id)).rows[0]
    if (!target) return
    await cancelPlan(client, target.plan_id)
    await cancelPlanTargets(client, target.plan_id)
    await cancelPlanJobs(client, target.plan_id, id)
  })
}
