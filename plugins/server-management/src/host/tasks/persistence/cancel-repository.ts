import type { DbClient } from '../../database/transaction.ts'

export function cancelActive(db: DbClient, id: string) {
  return db.query<{ id: string; purpose: string; target_id: string | null }>(
    `update server_jobs set state='cancelled',finished_at=now(),output_excerpt='任务已取消。'
     where id=$1 and state in ('queued','claimed','running','recovering')
     returning id,purpose,target_id`,
    [id],
  )
}

export function cancelTargetAndPlan(db: DbClient, targetId: string) {
  return db.query<{ plan_id: string }>(
    `update server_change_targets set state='cancelled',finished_at=now()
     where id=$1 and state in ('pending','running') returning plan_id`,
    [targetId],
  )
}

export function cancelPlan(db: DbClient, planId: string) {
  return db.query<never>(
    `update server_change_plans set state='cancelled'
     where id=$1 and state in ('scheduled','running','paused','blocked','partial_failure')`,
    [planId],
  )
}

export function cancelPlanTargets(db: DbClient, planId: string) {
  return db.query<never>(
    `update server_change_targets set state='cancelled',finished_at=now()
     where plan_id=$1 and state in ('pending','running')`,
    [planId],
  )
}

export function cancelPlanJobs(db: DbClient, planId: string, exceptId: string) {
  return db.query<never>(
    `update server_jobs set state='cancelled',finished_at=now(),output_excerpt='计划已取消。'
     where target_id in (select id from server_change_targets where plan_id=$1)
       and state in ('queued','claimed','running','recovering') and id<>$2`,
    [planId, exceptId],
  )
}
