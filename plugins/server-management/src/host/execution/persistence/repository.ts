import type { Db } from '../../database/connection.ts'
import type {
  AcceptedPlanInput,
  ClaimInput,
  FailBindingInput,
  FailDetectionInput,
  FinishInput,
  FinishTargetInput,
  HeartbeatInput,
  InsertApplyJobInput,
  InsertInspectionInput,
  InsertPreparationInput,
  InsertPreparedTargetInput,
  LockOwnershipInput,
  MatchingInspectionInput,
  RecoveringInput,
} from './inputs.ts'
import type {
  AcceptedPlanRow,
  JobRecord,
  LockServerRevisionRow,
  PlanAdmissionRow,
  ServerRevisionRow,
  TargetSnapshotRow,
} from './rows.ts'

export function lockServerRevision(db: Db, id: string) {
  return db.query<LockServerRevisionRow>(
    'select s.config_revision,r.environment_revision from servers s join server_runtime r on r.server_id=s.id where s.id=$1 for update of s',
    [id],
  )
}

export function matchingInspection(db: Db, { serverId, configRevision, snapshot }: MatchingInspectionInput) {
  return db.query<JobRecord>(
    `select * from server_jobs where server_id=$1 and purpose='inspect' and state in ('queued','claimed','running','recovering')
    and expected_config_revision=$2 and request_snapshot=$3::jsonb order by created_at limit 1`,
    [serverId, configRevision, snapshot],
  )
}

export function insertInspection(
  db: Db,
  {
    id,
    serverId,
    configRevision,
    environmentRevision,
    definitionRevision,
    operationId,
    snapshot,
  }: InsertInspectionInput,
) {
  return db.query<JobRecord>(
    `insert into server_jobs(id,server_id,server_identity,purpose,expected_config_revision,expected_environment_revision,definition_revision,idempotency_key,operation_id,request_snapshot)
    values($1,$2,$2,'inspect',$3,$4,$5,$1::uuid::text,$6,$7) returning *`,
    [id, serverId, configRevision, environmentRevision, definitionRevision, operationId, snapshot],
  )
}

export function nextCandidate(db: Db) {
  return db.query<JobRecord>(`select j.* from server_jobs j
      where (j.state in ('claimed','running','recovering') and j.lease_expires_at<now())
        or (j.state='queued' and not exists(select 1 from server_key_rotations r where r.server_id=j.server_id and r.state in ('prepared','deployed','switched','unknown')) and (j.purpose<>'apply_plan' or exists(select 1 from server_change_targets t join server_change_plans p on p.id=t.plan_id where t.id=j.target_id and p.state in ('scheduled','running') and p.window_start<=now() and p.window_end>now())) and not exists(select 1 from server_jobs active where active.server_id=j.server_id and active.state in ('claimed','running','recovering')))
      order by case when j.state='queued' then 1 else 0 end,j.created_at,j.id for update of j skip locked limit 1`)
}

export async function tryLockServer(db: Db, id: string) {
  const locked = await db.query<{ id: string }>('select id from servers where id=$1 for update skip locked', [id])
  if (!locked.rows.length) return locked
  // Read after acquiring the row lock so a rotation committed during lock acquisition is visible.
  const rotations = await db.query<{ id: string }>(
    "select id from server_key_rotations where server_id=$1 and state in ('prepared','deployed','switched','unknown')",
    [id],
  )
  return rotations.rows.length ? { rows: [] } : locked
}

export function activeJobs(db: Db, id: string) {
  return db.query<{ id: string }>(
    "select id from server_jobs where server_id=$1 and state in ('claimed','running','recovering')",
    [id],
  )
}

export function lockTargetPlan(db: Db, targetId: string | null) {
  return db.query<PlanAdmissionRow>(
    `select p.* from server_change_plans p join server_change_targets t on t.plan_id=p.id where t.id=$1 for update of p`,
    [targetId],
  )
}

export function activePlanCount(db: Db, planId: string | undefined) {
  return db.query<{ count: string }>(
    `select count(*) from server_jobs j join server_change_targets t on t.id=j.target_id where t.plan_id=$1 and j.purpose='apply_plan' and j.state in ('claimed','running','recovering')`,
    [planId],
  )
}

export function claim(db: Db, { id, state, workerId, leaseSeconds }: ClaimInput) {
  return db.query<JobRecord>(
    `update server_jobs set state=$2,phase=case when $2='recovering' then 'reconciling' else 'connecting' end,
      worker_id=$3,fence=fence+1,lease_expires_at=now()+make_interval(secs=>$4),heartbeat_at=now(),started_at=coalesce(started_at,now()) where id=$1 returning *`,
    [id, state, workerId, leaseSeconds],
  )
}

export function heartbeat(db: Db, { id, workerId, fence, leaseSeconds }: HeartbeatInput) {
  return db.query<{ id: string }>(
    `update server_jobs set heartbeat_at=now(),lease_expires_at=now()+make_interval(secs=>$4)
    where id=$1 and worker_id=$2 and fence=$3 and state in ('running','recovering') and lease_expires_at>now() returning id`,
    [id, workerId, fence, leaseSeconds],
  )
}

export function lockOwnership(db: Db, { id, workerId, fence }: LockOwnershipInput) {
  return db.query<{ id: string }>(
    `select id from server_jobs where id=$1 and worker_id=$2 and fence=$3 and state in ('running','recovering') and lease_expires_at>now() for update`,
    [id, workerId, fence],
  )
}

export function lockServer(db: Db, id: string) {
  return db.query<{ id: string }>('select id from servers where id=$1 for update', [id])
}

export function setPhase(db: Db, id: string, phase: string) {
  return db.query<never>(
    "update server_jobs set phase=$2,mutation_phase=case when $2 in ('installing','replacing','upgrading') then $2 else mutation_phase end where id=$1",
    [id, phase],
  )
}

export function finish(db: Db, { id, state, message, result }: FinishInput) {
  return db.query<never>(
    "update server_jobs set state=$2,phase='finished',output_excerpt=$3,result=$4,finished_at=now() where id=$1",
    [id, state, message, result],
  )
}

export function reportInspection(db: Db, id: string) {
  return db.query<never>(
    `insert into server_inspection_reports(server_identity,hour_start,succeeded,failed,last_checked_at)
        select server_identity,date_trunc('hour',finished_at at time zone 'UTC') at time zone 'UTC',
          case when state='succeeded' then 1 else 0 end,case when state='succeeded' then 0 else 1 end,finished_at
        from server_jobs where id=$1
        on conflict(server_identity,hour_start) do update set
          succeeded=server_inspection_reports.succeeded+excluded.succeeded,
          failed=server_inspection_reports.failed+excluded.failed,
          last_checked_at=greatest(server_inspection_reports.last_checked_at,excluded.last_checked_at)`,
    [id],
  )
}

export function failDetection(db: Db, { serverId, result, intervalSeconds }: FailDetectionInput) {
  return db.query<never>(
    `update server_software_policies set check_error=$2,last_check_at=now(),next_check_at=case when detect_updates then now()+make_interval(secs=>$3) else null end where server_id=$1`,
    [serverId, result, intervalSeconds],
  )
}

export function targetSnapshot(db: Db, targetId: string | null) {
  return db.query<TargetSnapshotRow>('select target_snapshot from server_change_targets where id=$1', [
    targetId,
  ])
}

export function failBinding(db: Db, { id, state, result, message }: FailBindingInput) {
  return db.query<never>('update server_jobs set state=$2,result=$3,output_excerpt=$4 where id=$1', [
    id,
    state,
    result,
    message,
  ])
}

export function satisfySuggestions(db: Db, serverId: string, targetId: string | null) {
  return db.query<never>(
    "update server_upgrade_suggestions set validity='satisfied' where server_id=$1 and target_identity in (select target_snapshot->'changes'->i->'target'->>'targetIdentity' from server_change_targets,generate_series(0,jsonb_array_length(target_snapshot->'changes')-1) i where id=$2)",
    [serverId, targetId],
  )
}

export function finishTarget(db: Db, { targetId, state, result }: FinishTargetInput) {
  return db.query<{ plan_id: string }>(
    'update server_change_targets set state=$2,result=$3,finished_at=now() where id=$1 returning plan_id',
    [targetId, state, result],
  )
}

export function lockPlanState(db: Db, planId: string) {
  return db.query<{ state: string }>('select state from server_change_plans where id=$1 for update', [planId])
}

export function targetStates(db: Db, planId: string) {
  return db.query<{ state: string }>('select state from server_change_targets where plan_id=$1', [planId])
}

export function setPlanState(db: Db, planId: string, state: string) {
  return db.query<never>('update server_change_plans set state=$2,updated_at=now() where id=$1', [
    planId,
    state,
  ])
}

export function recovering(db: Db, { id, message, remoteState }: RecoveringInput) {
  return db.query<never>(
    `update server_jobs set state='recovering',phase='reconciling',output_excerpt=$2,recovery_attempts=recovery_attempts+1,lease_expires_at=now()+interval '30 seconds',
        result=coalesce(result,'{}'::jsonb)||jsonb_build_object('remote_state',$3::text,'remote_checked_at',now()) where id=$1`,
    [id, message, remoteState],
  )
}

export function serverRevision(db: Db, id: string) {
  return db.query<ServerRevisionRow>('select config_revision from servers where id=$1', [id])
}

export function findPlan(db: Db, id: string) {
  return db.query<{ id: string }>('select id from server_change_plans where id=$1', [id])
}

export function insertPreparation(
  db: Db,
  { id, fingerprint, authorization, start, end, snapshot }: InsertPreparationInput,
) {
  return db.query<never>(
    `insert into server_change_plans(id,kind,state,confirmation_digest,confirmed_by,confirmed_at,authorization_kind,window_start,window_end,timezone,request_snapshot)
      values($1,'prepare','scheduled',$2,$3,now(),'missing_software_only',$4,$5,'UTC',$6)`,
    [id, fingerprint, authorization, start, end, snapshot],
  )
}

export function insertPreparedTarget(
  db: Db,
  {
    id,
    planId,
    serverId,
    snapshot,
    configRevision,
    environmentRevision,
    definitionRevision,
    plan,
  }: InsertPreparedTargetInput,
) {
  return db.query<never>(
    `insert into server_change_targets(id,plan_id,server_id,server_identity,server_snapshot,expected_config_revision,expected_environment_revision,definition_revision,target_snapshot)
      values($1,$2,$3,$3,$4,$5,$6,$7,$8)`,
    [id, planId, serverId, snapshot, configRevision, environmentRevision, definitionRevision, plan],
  )
}

export function insertApplyJob(
  db: Db,
  {
    id,
    serverId,
    targetId,
    configRevision,
    environmentRevision,
    definitionRevision,
    operationId,
    snapshot,
  }: InsertApplyJobInput,
) {
  return db.query<never>(
    `insert into server_jobs(id,server_id,server_identity,target_id,purpose,expected_config_revision,expected_environment_revision,definition_revision,idempotency_key,operation_id,request_snapshot)
      values($1,$2,$2,$3,'apply_plan',$4,$5,$6,$1::uuid::text,$7,$8)`,
    [id, serverId, targetId, configRevision, environmentRevision, definitionRevision, operationId, snapshot],
  )
}

export function acceptedPlan(
  db: Db,
  { targetId, serverId, configRevision, definitionRevision }: AcceptedPlanInput,
) {
  return db.query<AcceptedPlanRow>(
    `select t.target_snapshot,p.confirmation_digest,p.state,p.window_start,p.window_end,p.request_snapshot from server_change_targets t join server_change_plans p on p.id=t.plan_id
    where t.id=$1 and t.server_id=$2 and t.expected_config_revision=$3 and t.definition_revision=$4 and p.confirmed_at is not null for update of p,t`,
    [targetId, serverId, configRevision, definitionRevision],
  )
}

export function beginMutation(db: Db, id: string, phase: string) {
  return db.query<never>('update server_jobs set phase=$2,mutation_phase=$2 where id=$1', [id, phase])
}

export function startTarget(db: Db, targetId: string | null) {
  return db.query<never>(
    "update server_change_targets set state='running',mutation_started_at=coalesce(mutation_started_at,now()) where id=$1",
    [targetId],
  )
}

export function startPlan(db: Db, targetId: string | null) {
  return db.query<never>(
    "update server_change_plans p set state='running' from server_change_targets t where p.id=t.plan_id and t.id=$1",
    [targetId],
  )
}
