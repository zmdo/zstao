import { type Db } from '../../database/connection.ts'
import type { SetReminderInput } from './inputs.ts'
import type {
  DetectionRow,
  ExecutionRecordRow,
  InventoryRow,
  ServerSignatureRow,
  SuggestionIdentityRow,
  SuggestionRow,
  VersionCheckRow,
} from './rows.ts'

export function inventory(db: Db) {
  return db.query<InventoryRow>(
    `select id,name,group_id,type_key,type_snapshot->'name_i18n' as type_name_i18n,type_snapshot->'software' as required_software from servers order by name,id`,
  )
}

export function lockSuggestion(db: Db, id: string) {
  return db.query<SuggestionIdentityRow>(
    'select server_id,software_key from server_upgrade_suggestions where id=$1 for update',
    [id],
  )
}

export function setDecision(db: Db, id: string, decision: 'rejected' | 'none') {
  return db.query<never>(
    "update server_upgrade_suggestions set decision=$2,decision_at=case when $2='rejected' then now() else null end where id=$1",
    [id, decision],
  )
}

export function setReminder(db: Db, { serverId, softwareKey, until }: SetReminderInput) {
  return db.query<never>(
    'update server_software_policies set reminder_after=$3 where server_id=$1 and software_key=$2',
    [serverId, softwareKey, until],
  )
}

export function suggestions(db: Db) {
  return db.query<SuggestionRow>(`select u.*,s.name as server_name,s.host,s.group_id,s.type_key,r.connection_state,p.reminder_after,
   p.check_error,p.last_check_at,(select g.name from server_groups g where g.id=s.group_id) as group_name,
   exists(select 1 from server_change_targets t join server_change_plans cp on cp.id=t.plan_id where t.server_id=s.id and cp.state in ('scheduled','running') and cp.kind='upgrade') as scheduled
   from server_upgrade_suggestions u join servers s on s.id=u.server_id join server_runtime r on r.server_id=s.id
   left join server_software_policies p on p.server_id=u.server_id and p.software_key=u.software_key
   where u.validity in ('eligible','blocked') and u.basis_snapshot->>'configRevision'=s.config_revision::text and u.basis_snapshot->>'environmentRevision'=r.environment_revision::text order by s.name,u.software_key,u.product_version`)
}

export function checks(db: Db) {
  return db.query<DetectionRow>(
    `select p.server_id,p.software_key,p.last_check_at,p.check_error,p.check_snapshot,s.name as server_name,s.host,s.group_id,s.type_key,r.connection_state from server_software_policies p join servers s on s.id=p.server_id join server_runtime r on r.server_id=s.id where p.last_check_at is not null order by p.last_check_at desc limit 200`,
  )
}

export function versionChecks(db: Db, ids: string[], software: string) {
  return db.query<VersionCheckRow>(
    `select p.server_id,p.check_snapshot,s.config_revision,r.environment_revision from server_software_policies p join servers s on s.id=p.server_id join server_runtime r on r.server_id=s.id where p.server_id=any($1::uuid[]) and p.software_key=$2`,
    [ids, software],
  )
}

export interface RecordFilter {
  query: string
  state: string
  since: Date | null
}

export function records(db: Db, offset: number, limit: number, filter: RecordFilter) {
  return db.query<ExecutionRecordRow>(
    `select j.id,j.server_identity,j.state,j.phase,j.request_snapshot,j.result,j.output_excerpt,j.created_at,j.finished_at,t.server_snapshot,t.plan_id,
   coalesce((select jsonb_agg(st order by st.ordinal) from server_job_steps st where st.job_id=j.id),'[]'::jsonb) as steps
   from server_jobs j join server_change_targets t on t.id=j.target_id join server_change_plans p on p.id=t.plan_id
   where j.purpose='apply_plan' and p.kind in ('upgrade','move')
     and ($3='' or t.server_snapshot->>'name' ilike '%' || $3 || '%' or p.id::text ilike '%' || $3 || '%')
     and ($4='' or j.state=$4)
     and ($5::timestamptz is null or j.created_at >= $5::timestamptz)
   order by j.created_at desc limit $2 offset $1`,
    [offset, limit, filter.query, filter.state, filter.since],
  )
}

export function recordCount(db: Db, filter: RecordFilter) {
  return db.query<{ count: string }>(
    `select count(*) from server_jobs j join server_change_targets t on t.id=j.target_id join server_change_plans p on p.id=t.plan_id
     where j.purpose='apply_plan' and p.kind in ('upgrade','move')
       and ($1='' or t.server_snapshot->>'name' ilike '%' || $1 || '%' or p.id::text ilike '%' || $1 || '%')
       and ($2='' or j.state=$2)
       and ($3::timestamptz is null or j.created_at >= $3::timestamptz)`,
    [filter.query, filter.state, filter.since],
  )
}

export function signatureServers(db: Db, ids: string[]) {
  return db.query<ServerSignatureRow>(
    `select s.id,s.group_id,s.type_key,s.declared_os,r.detected_os from servers s join server_runtime r on r.server_id=s.id where s.id=any($1::uuid[])`,
    [ids],
  )
}
