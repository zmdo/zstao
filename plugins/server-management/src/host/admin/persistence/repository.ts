import { randomUUID } from 'node:crypto'
import type { Db } from '../../database/connection.ts'
import type { AdminContext, Input } from '../model.ts'
import { AdminError } from '../model.ts'
import type { GroupRow } from '../../groups/persistence/rows.ts'

export function approvalGroups(db: Db, ids: string[]) {
  return db.query<GroupRow>('select * from server_groups where id=any($1::uuid[])', [ids])
}
export function approvalServer(db: Db, id: string) {
  return db.query<{ name: string; host: string }>('select name,host from servers where id=$1', [id])
}

export async function account(db: Db): Promise<string> {
  const rows = (await db.query<{ username: string }>('select username from accounts limit 2')).rows
  if (rows.length !== 1) throw new AdminError('single_user_account_required')
  return rows[0]!.username
}
export async function audit(
  db: Db,
  input: {
    tool: string
    action: string
    target: string
    before?: unknown
    after?: unknown
    parameters?: unknown
    status: string
    actor: string
    context: AdminContext
    approval: string
    id?: string
  },
) {
  const id = input.id ?? randomUUID()
  const targetType =
    input.tool === 'platform_server_group_admin'
      ? 'group'
      : input.tool === 'platform_server_key_admin'
        ? input.action.startsWith('rotate')
          ? 'server'
          : 'key'
        : input.tool === 'platform_server_upgrade_admin'
          ? input.action === 'plan'
            ? 'server'
            : 'plan'
          : input.tool === 'platform_server_admin'
            ? 'server'
            : input.action === 'export'
              ? 'audit_export'
              : 'audit_policy'
  const before = input.before as Input | undefined
  const snapshot = (before?.before ?? before) as Input | undefined
  const identity = targetType === 'server' && snapshot?.host ? snapshot : undefined
  const authorization = input.context.authorization
  const fullAccess = input.approval === 'approved' && authorization?.source === 'full-access'
  const approvalStatus = fullAccess ? 'not_required' : input.approval
  await db.query<Record<string, unknown>>(
    `insert into server_audit_log(id,kind,actor_id,actor_kind,harness_session_id,agent_id,tool_call_id,root_tool_call_id,tool_name,permission_mode,approval_status,approval_id,approved_by,approved_at,status,finished_at,metadata,server_id,server_name,host,harness_turn,harness_step,harness_event_seq)
    values($1,'admin',$2,$11,$3,$3,$4,$5,$6,$20,$7,$18,$8,case when $7='approved' then coalesce($19::timestamptz,now()) end,$9,case when $9='pending' then null else now() end,$10,(select id from servers where id=$12),$13,$14,$15,$16,$17)`,
    [
      id,
      input.actor,
      input.context.agent?.id ?? null,
      input.context.callId,
      input.context.rootCallId ?? input.context.callId,
      input.tool,
      approvalStatus,
      approvalStatus === 'approved' ? input.actor : null,
      input.status,
      {
        action: input.action,
        target_type: targetType,
        target_id:
          input.target === 'new' ? ((input.after as Input | undefined)?.id ?? 'new') : input.target,
        before: input.before ?? null,
        after: input.after ?? null,
        parameters: input.parameters ?? null,
        authorization_source:
          authorization?.source ?? (input.approval === 'approved' ? 'user-approval' : null),
        authorization_call_id: input.context.approvalId ?? input.context.callId,
      },
      input.context.source ?? 'harness',
      identity ? input.target : null,
      identity?.name ?? null,
      identity?.host ?? null,
      input.context.harnessTurn ?? null,
      input.context.harnessStep ?? null,
      input.context.harnessEventSeq ?? null,
      fullAccess ? null : (input.context.approvalId ?? input.context.callId),
      input.context.approvedAt ?? null,
      authorization?.permissionMode ?? 'admin',
    ],
  )
  return id
}
export async function finish(db: Db, id: string, status: string, result: unknown) {
  await db.query<Record<string, unknown>>(
    "update server_audit_log set status=$2,finished_at=now(),metadata=metadata||jsonb_build_object('result',$3::jsonb) where id=$1",
    [id, status, JSON.stringify(result)],
  )
}
export async function serverSnapshot(db: Db, id: string, lock = false): Promise<Input> {
  if (lock)
    await db.query<Record<string, unknown>>('select id from servers where id=$1 for update', [id])
  const row = (
    await db.query<Input>(
      `select id,name,host,host_fingerprint,ssh_port,ssh_user,auth_method,ssh_key_id,(select name from ssh_keys where id=servers.ssh_key_id) as key_name,(select fingerprint from ssh_keys where id=servers.ssh_key_id) as key_fingerprint,group_id,type_key,region,declared_os,install_required_software,config_revision::text from servers where id=$1`,
      [id],
    )
  ).rows[0]
  if (!row) throw new AdminError('server_not_found')
  const tasks = (
    await db.query<Record<string, unknown>>(
      "select id,state from server_jobs where server_id=$1 and state in ('queued','claimed','running','recovering') order by id",
      [id],
    )
  ).rows
  const plans = (
    await db.query<Record<string, unknown>>(
      "select p.id,p.state,p.revision::text,(select jsonb_agg(t2.server_identity order by t2.server_identity) from server_change_targets t2 where t2.plan_id=p.id) as servers from server_change_plans p where exists(select 1 from server_change_targets t where t.plan_id=p.id and t.server_id=$1 and t.state='pending') order by p.id",
      [id],
    )
  ).rows
  const rotations = (
    await db.query<Input>(
      "select id,old_key_id,new_key_id,state,phase from server_key_rotations where server_id=$1 and state in ('prepared','deployed','switched','unknown') order by id",
      [id],
    )
  ).rows
  return { ...row, tasks, plans, rotations }
}
export async function groupSnapshot(db: Db, id: string, lock = false): Promise<Input> {
  if (lock)
    await db.query<Record<string, unknown>>('select id from server_groups where id=$1 for update', [
      id,
    ])
  const row = (await db.query<Input>('select id,name,kind from server_groups where id=$1', [id]))
    .rows[0]
  if (!row) throw new AdminError('group_not_found')
  const members = (
    await db.query<Record<string, unknown>>(
      'select id,name,host,type_key,config_revision::text from servers where group_id=$1 order by id' +
        (lock ? ' for update' : ''),
      [id],
    )
  ).rows
  return { ...row, members }
}
export async function keySnapshot(db: Db, id: string, lock = false): Promise<Input> {
  const row = (
    await db.query<Input>(
      'select id,name,fingerprint,created_at from ssh_keys where id=$1' +
        (lock ? ' for update' : ''),
      [id],
    )
  ).rows[0]
  if (!row) throw new AdminError('key_not_found')
  return {
    ...row,
    servers: (
      await db.query<Record<string, unknown>>(
        'select id,name,host,config_revision::text from servers where ssh_key_id=$1 order by id',
        [id],
      )
    ).rows,
  }
}

export function keyFingerprintRow<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select fingerprint from ssh_keys where id=$1', params)
}

export function insertKeyDownload<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "insert into server_admin_downloads(id,kind,target_id,fingerprint,expires_at) values($1,'key',$2,$3,now()+interval '10 minutes')",
    params,
  )
}

export function latestConnectionJob<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "select id,state from server_jobs where server_id=$1 and purpose='inspect' and request_snapshot->>'action'='test_connection' and state in ('queued','claimed','running') order by created_at desc limit 1",
    params,
  )
}

export function lockChangePlan<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select id from server_change_plans where id=$1 for update', params)
}

export function filteredAudits<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    `select * from server_audit_log where ${FILTER} order by created_at desc,id desc limit $8 offset $9`,
    params,
  )
}

export function filteredAuditCount<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(`select count(*) from server_audit_log where ${FILTER}`, params)
}

export function exportAudits<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    `select * from server_audit_log where ${FILTER} order by created_at,id limit $8`,
    params,
  )
}

export function insertAuditDownload<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "insert into server_admin_downloads(id,kind,content,expires_at) values($1,'audit',$2,now()+interval '10 minutes')",
    params,
  )
}

export function retentionPolicy<T = Record<string, unknown>>(
  db: Db,
  params: unknown[] = [],
  lock = false,
) {
  return db.query<T>(
    'select days,archive_directory,next_run,revision::text,enabled,approved_by,approval_id,authorization_source,updated_at as approved_at from server_audit_retention where id=true' +
      (lock ? ' for update' : ''),
    params,
  )
}

export function saveRetentionPolicy<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    `insert into server_audit_retention(id,days,archive_directory,next_run,enabled,approved_by,approval_id,authorization_source) values(true,$1,$2,$3,$4,$5,$6,$7)
      on conflict(id) do update set days=$1,archive_directory=$2,next_run=$3,enabled=$4,approved_by=$5,approval_id=$6,authorization_source=$7,revision=server_audit_retention.revision+1,updated_at=now()`,
    params,
  )
}

export function lockRetention<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "select pg_advisory_xact_lock(hashtextextended('smp/audit-retention',0))",
    params,
  )
}

export function expiredAudits<T = Record<string, unknown>>(
  db: Db,
  params: unknown[] = [],
  lock = true,
) {
  return db.query<T>(
    "select * from server_audit_log where created_at<$1 and status<>'pending' and not(kind='admin' and coalesce(metadata->>'action','')='retention') and not exists(select 1 from server_key_rotations r where r.audit_id=server_audit_log.id and r.state in ('prepared','deployed','switched','unknown')) order by created_at,id limit $2" +
      (lock ? ' for update' : ''),
    params,
  )
}

export function deleteArchivedAudits<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('delete from server_audit_log where id=any($1::uuid[])', params)
}

export function advanceRetention<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "update server_audit_retention set next_run=now()+interval '1 day' where id=true",
    params,
  )
}

const FILTER =
  "($1::timestamptz is null or created_at >= $1) and ($2::timestamptz is null or created_at < $2) and ($3::uuid is null or server_id=$3) and ($4='' or kind=$4) and ($5='' or status=$5) and ($6='' or harness_session_id=$6) and ($7='' or tool_name=$7)"

export function readDownload<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    'select * from server_admin_downloads where id=$1 and consumed_at is null and expires_at>now()',
    params,
  )
}

export function setDownloadChallenge<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('update server_admin_downloads set csrf=$2,content=null where id=$1', params)
}

export function lockDownload<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    'select * from server_admin_downloads where id=$1 and consumed_at is null and expires_at>now() for update',
    params,
  )
}

export function keySecret<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select secret_ciphertext from ssh_keys where id=$1', params)
}

export function consumeDownload<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    'update server_admin_downloads set consumed_at=now(),content=null,csrf=null where id=$1',
    params,
  )
}

export function readRotation<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select * from server_key_rotations where id=$1', params)
}

export function rotationKey<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select secret_ciphertext,fingerprint from ssh_keys where id=$1', params)
}

export function tryLockRotation<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select pg_try_advisory_lock(hashtextextended($1,0)) as locked', params)
}

export function rotationActiveJobs<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "select id from server_jobs where server_id=$1 and state in ('claimed','running','recovering')",
    params,
  )
}

export function insertRotationKey<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    'insert into ssh_keys(id,name,fingerprint,secret_ciphertext) values($1,$2,$3,$4)',
    params,
  )
}

export function insertRotation<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "insert into server_key_rotations(id,server_id,old_key_id,new_key_id,state,config_revision,audit_id) values($1,$2,$3,$4,'prepared',$5,$6)",
    params,
  )
}

export function currentKeyReference<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select ssh_key_id from servers where id=$1', params)
}

export function markRotationDeployed<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "update server_key_rotations set state='deployed',phase='deployed',updated_at=now() where id=$1",
    params,
  )
}

export function lockRotationServer<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select id from servers where id=$1 for update', params)
}

export function switchKeyReference<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    'update servers set ssh_key_id=$2,config_revision=config_revision+1,updated_at=now() where id=$1 and ssh_key_id=$3 and config_revision=$4 returning id',
    params,
  )
}

export function isKeySwitched<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    'select id from servers where id=$1 and ssh_key_id=$2 and config_revision=$3',
    params,
  )
}

export function markRotationSwitched<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "update server_key_rotations set state='switched',phase='switched',updated_at=now() where id=$1",
    params,
  )
}

export function completeRotation<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "update server_key_rotations set state='completed',phase='completed',updated_at=now() where id=$1",
    params,
  )
}

export function markRotationUnknown<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>(
    "update server_key_rotations set state='unknown',updated_at=now() where id=$1 and state<>'completed'",
    params,
  )
}

export function unlockRotation<T = Record<string, unknown>>(db: Db, params: unknown[] = []) {
  return db.query<T>('select pg_advisory_unlock(hashtextextended($1,0))', params)
}
export function purgeDownloads(db: Db) {
  return db.query<never>(
    'delete from server_admin_downloads where consumed_at is not null or expires_at<=now()',
  )
}
