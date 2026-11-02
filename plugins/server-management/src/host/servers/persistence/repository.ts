import { type Db } from '../../database/connection.ts'
import type { InsertServerInput, ServerPatch } from './inputs.ts'
import type { ServerBindingRow, SoftwarePolicyRecord } from './rows.ts'
import { type EditableServer } from './rows.ts'

export function policies(db: Db, id: string) {
  return db.query<SoftwarePolicyRecord>(
    'select * from server_software_policies where server_id=$1 order by software_key',
    [id],
  )
}

export function insertServer(
  db: Db,
  {
    id,
    name,
    host,
    port,
    user,
    method,
    ciphertext,
    keyId,
    groupId,
    region,
    auto,
    os,
    typeKey,
    typeSnapshot,
    typeRevision,
  }: InsertServerInput,
) {
  return db.query<never>(
    `insert into servers (id, name, host, ssh_port, ssh_user, auth_method, secret_ciphertext, ssh_key_id, group_id, region,
          install_required_software, declared_os, type_key, type_snapshot, type_revision)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      name,
      host,
      port,
      user,
      method,
      ciphertext,
      keyId,
      groupId,
      region,
      auto,
      os,
      typeKey,
      typeSnapshot,
      typeRevision,
    ],
  )
}

export function insertRuntime(db: Db, id: string) {
  return db.query<never>('insert into server_runtime(server_id) values ($1)', [id])
}

export function lockEditable(db: Db, id: string) {
  return db.query<EditableServer>(
    'select id, host, ssh_port, ssh_user, auth_method, ssh_key_id, install_required_software, declared_os, group_id, type_key, type_snapshot, type_revision, config_revision from servers where id = $1 for update',
    [id],
  )
}

export function obsoleteSuggestions(db: Db, id: string) {
  return db.query<never>(
    "update server_upgrade_suggestions set validity='obsolete' where server_id=$1 and validity in ('eligible','blocked')",
    [id],
  )
}

export function resetConnection(db: Db, id: string) {
  return db.query<never>(
    "update server_runtime set connection_state='unknown', connection_error=null, connection_checked_at=null, auto_retry_at=null, auto_retry_attempts=0 where server_id=$1",
    [id],
  )
}

export function activeJobs(db: Db, id: string) {
  return db.query<{ id: string }>(
    "select id from server_jobs where server_id = $1 and state in ('claimed','running','recovering') limit 1",
    [id],
  )
}

export function lockBinding(db: Db, id: string) {
  return db.query<ServerBindingRow>(
    'select id, group_id, type_key, config_revision, declared_os from servers where id = $1 for update',
    [id],
  )
}

export function lockServer(db: Db, id: string) {
  return db.query<{ id: string }>('select id from servers where id=$1 for update', [id])
}

export function cancelQueuedJobs(db: Db, id: string) {
  return db.query<never>(
    "update server_jobs set state='cancelled',finished_at=now() where server_id=$1 and state='queued'",
    [id],
  )
}

export function cancelPendingPlans(db: Db, id: string) {
  return db.query<never>(
    "update server_change_plans p set state='cancelled' from server_change_targets t where p.id=t.plan_id and t.server_id=$1 and t.state='pending'",
    [id],
  )
}

export function cancelPendingTargets(db: Db, id: string) {
  return db.query<never>(
    "update server_change_targets set state='cancelled',finished_at=now() where server_id=$1 and state='pending'",
    [id],
  )
}

export function deleteServer(db: Db, id: string) {
  return db.query<never>('delete from servers where id=$1', [id])
}

export function findServer(db: Db, id: string) {
  return db.query<{ id: string }>('select id from servers where id = $1', [id])
}

export function updateServer(db: Db, id: string, patch: ServerPatch) {
  const params: unknown[] = [id]
  const sets = Object.entries(patch).map(([column, value]) => {
    params.push(value)
    return `${column} = $${params.length}`
  })
  return db.query<never>(`update servers set ${sets.join(', ')}, updated_at = now() where id = $1`, params)
}

export function saveInternalHost(db: Db, serverId: string, host: string) {
  return db.query<never>('update servers set internal_host=$2, updated_at=now() where id=$1', [serverId, host])
}
export function activeRotations(db: Db, id: string) {
  return db.query<{ id: string; old_key_id: string; new_key_id: string; state: string; phase: string }>(
    "select id,old_key_id,new_key_id,state,phase from server_key_rotations where server_id=$1 and state in ('prepared','deployed','switched','unknown')",
    [id],
  )
}
