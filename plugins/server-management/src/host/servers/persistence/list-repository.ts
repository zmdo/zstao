import { type Db } from '../../database/connection.ts'
import type { ServerScope } from './inputs.ts'
import type { ServerCountsRow, ServerPolicyRow, SnapshotTimeRow, UpgradeCountsRow } from './rows.ts'
import { type ActiveOperation, type ServerFact, type SoftwareFact } from './rows.ts'

export function snapshotTime(db: Db) {
  return db.query<SnapshotTimeRow>('select now() as now')
}

export function counts(db: Db) {
  return db.query<ServerCountsRow>(
    `select count(*)::int as all,count(*) filter(where group_id is null)::int as ungrouped from servers`,
  )
}

export function servers(db: Db, { id, allGroups, groupId }: ServerScope) {
  return db.query<ServerFact>(
    `select s.id,s.name,s.host,s.ssh_port,s.ssh_user,s.auth_method,s.ssh_key_id,s.group_id,
      s.region,s.internal_host,s.install_required_software,s.type_key,s.type_snapshot,s.type_revision,s.config_revision,s.declared_os,s.host_fingerprint,s.created_at,
      r.connection_state as reachability,r.connection_error,r.connection_checked_at as last_checked_at,
      r.detected_os,r.os_probe_state,r.observed_config_revision,r.environment_revision,r.os_checked_at,r.os_error,
      r.cpu_model,r.cpu_cores,r.cpu_percent,r.memory_total_bytes as mem_total_bytes,r.memory_used_bytes as mem_used_bytes,r.disk_total_bytes,r.disk_used_bytes,r.metrics_sampled_at as metrics_at
      from servers s join server_runtime r on r.server_id=s.id
      where ($1::uuid is null or s.id=$1) and ($2::boolean or s.group_id is not distinct from $3::uuid)`,
    [id, allGroups, groupId],
  )
}

export function observations(db: Db, ids: string[]) {
  return db.query<SoftwareFact>(
    'select * from server_software_observations where server_id=any($1::uuid[])',
    [ids],
  )
}

export function operations(db: Db, ids: string[]) {
  return db.query<ActiveOperation>(
    `select id,server_id,state,phase,mutation_phase,lease_expires_at,result from server_jobs
      where server_id=any($1::uuid[]) and state in ('claimed','running','recovering')`,
    [ids],
  )
}

export function policies(db: Db, ids: string[]) {
  return db.query<ServerPolicyRow>(
    'select server_id,software_key,restriction,detect_updates from server_software_policies where server_id=any($1::uuid[])',
    [ids],
  )
}

export function upgradeCounts(db: Db, ids: string[]) {
  return db.query<UpgradeCountsRow>(
    `select u.server_id,u.basis_snapshot->>'definitionRevision' as definition,count(*)::int as count from server_upgrade_suggestions u join servers s on s.id=u.server_id join server_runtime r on r.server_id=s.id where u.server_id=any($1::uuid[]) and u.validity='eligible' and u.decision='none' and u.basis_snapshot->>'configRevision'=s.config_revision::text and u.basis_snapshot->>'environmentRevision'=r.environment_revision::text group by u.server_id,u.basis_snapshot->>'definitionRevision'`,
    [ids],
  )
}
