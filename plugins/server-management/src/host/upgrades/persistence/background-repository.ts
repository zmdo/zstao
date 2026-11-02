import type { Db } from '../../database/connection.ts'
import type {
  InsertDetectionInput,
  SatisfySuggestionInput,
  SaveCheckInput,
  UpsertSuggestionInput,
} from './inputs.ts'
import type { LockServerRevisionRow } from './rows.ts'

export function ensurePolicy(db: Db, serverId: string, software: string) {
  return db.query<never>(
    `insert into server_software_policies(server_id,software_key) values($1,$2) on conflict do nothing`,
    [serverId, software],
  )
}

export function saveCheck(db: Db, { serverId, software, intervalSeconds, snapshot, error }: SaveCheckInput) {
  return db.query<never>(
    `update server_software_policies set last_check_at=now(),next_check_at=case when detect_updates then now()+make_interval(secs=>$3) else null end,
    check_snapshot=$4,check_error=$5 where server_id=$1 and software_key=$2`,
    [serverId, software, intervalSeconds, snapshot, error],
  )
}

export function obsoleteSuggestions(db: Db, serverId: string, software: string) {
  return db.query<never>(
    "update server_upgrade_suggestions set validity='obsolete' where server_id=$1 and software_key=$2 and validity<>'satisfied'",
    [serverId, software],
  )
}

export function upsertSuggestion(
  db: Db,
  { id, serverId, software, targetIdentity, version, candidate, basis, reason }: UpsertSuggestionInput,
) {
  return db.query<never>(
    `insert into server_upgrade_suggestions(id,server_id,software_key,target_identity,product_version,candidate_snapshot,basis_snapshot,validity,reason)
    values($1,$2,$3,$4,$5,$6,$7,'eligible',$8)
    on conflict(server_id,software_key,target_identity) do update set candidate_snapshot=excluded.candidate_snapshot,basis_snapshot=excluded.basis_snapshot,validity='eligible',reason=excluded.reason,last_seen_at=now()`,
    [id, serverId, software, targetIdentity, version, candidate, basis, reason],
  )
}

export function satisfySuggestion(db: Db, { serverId, software, targetIdentity }: SatisfySuggestionInput) {
  return db.query<never>(
    `update server_upgrade_suggestions set validity='satisfied' where server_id=$1 and software_key=$2 and target_identity=$3`,
    [serverId, software, targetIdentity],
  )
}

export function lockServerRevision(db: Db, id: string) {
  return db.query<LockServerRevisionRow>(
    'select s.config_revision,r.environment_revision from servers s join server_runtime r on r.server_id=s.id where s.id=$1 for update of s',
    [id],
  )
}

export function ensurePolicies(db: Db, id: string) {
  return db.query<never>(
    `insert into server_software_policies(server_id,software_key) select s.id,item->>'software_key' from servers s cross join lateral jsonb_array_elements(s.type_snapshot->'software') item where s.id=$1 and item->>'software_key' is not null on conflict do nothing`,
    [id],
  )
}

export function activeDetection(db: Db, id: string) {
  return db.query<{ id: string }>(
    "select id from server_jobs where server_id=$1 and purpose='detect_updates' and state in ('queued','claimed','running','recovering')",
    [id],
  )
}

export function insertDetection(
  db: Db,
  { id, serverId, configRevision, environmentRevision, operationId, snapshot }: InsertDetectionInput,
) {
  return db.query<never>(
    `insert into server_jobs(id,server_id,server_identity,purpose,expected_config_revision,expected_environment_revision,definition_revision,idempotency_key,operation_id,request_snapshot)
   values($1,$2,$2,'detect_updates',$3,$4,'',$1::uuid::text,$5,$6)`,
    [id, serverId, configRevision, environmentRevision, operationId, snapshot],
  )
}

export function advanceChecks(db: Db, id: string, intervalSeconds: number) {
  return db.query<never>(
    'update server_software_policies set next_check_at=now()+make_interval(secs=>$2) where server_id=$1 and detect_updates and (next_check_at is null or next_check_at<=now())',
    [id, intervalSeconds],
  )
}

export function expiredPlans(db: Db) {
  return db.query<{ id: string }>(
    "select id from server_change_plans where state in ('scheduled','running') and window_end<now() for update skip locked",
  )
}

export function cancelExpiredJobs(db: Db, planId: string) {
  return db.query<never>(
    `update server_jobs j set state='cancelled',phase='finished',finished_at=now(),result='{"summary":"window_missed"}' from server_change_targets t
    where j.target_id=t.id and t.plan_id=$1 and j.state='queued'`,
    [planId],
  )
}

export function skipExpiredTargets(db: Db, planId: string) {
  return db.query<never>(
    "update server_change_targets set state='skipped',finished_at=now(),result='{}' where plan_id=$1 and state='pending'",
    [planId],
  )
}

export function runningTargets(db: Db, planId: string) {
  return db.query<{ id: string }>(
    "select id from server_change_targets where plan_id=$1 and state='running'",
    [planId],
  )
}

export function markMissed(db: Db, planId: string) {
  return db.query<never>(
    "update server_change_plans set state=case when exists(select 1 from server_change_targets where plan_id=$1 and state='skipped') then 'missed' else state end where id=$1",
    [planId],
  )
}

export function dueChecks(db: Db) {
  return db.query<{ server_id: string }>(
    `select distinct server_id from server_software_policies where detect_updates and (next_check_at is null or next_check_at<=now()) limit 50`,
  )
}
