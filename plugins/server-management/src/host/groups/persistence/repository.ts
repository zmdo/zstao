import { type Db } from '../../database/connection.ts'
import type { GroupMemberRow, LockGroupRow } from './rows.ts'
import { type GroupRow } from './rows.ts'

export function listGroups(db: Db) {
  return db.query<GroupRow>(
    `select g.*, (select count(*)::int from servers s where s.group_id = g.id) as server_count from server_groups g order by sort_order, created_at, id`,
  )
}

export function insertGroup(db: Db, id: string, name: string) {
  return db.query<GroupRow>('insert into server_groups (id, name) values ($1, $2) returning *', [id, name])
}

export function lockGroup(db: Db, id: string) {
  return db.query<LockGroupRow>('select kind from server_groups where id = $1 for update', [id])
}

export function lockMembers(db: Db, id: string) {
  return db.query<GroupMemberRow>(
    'select s.id,s.type_key,s.declared_os,s.config_revision,r.detected_os,r.os_probe_state,r.observed_config_revision from servers s join server_runtime r on r.server_id=s.id where s.group_id=$1 for update of s',
    [id],
  )
}

export function unbindMembers(db: Db, id: string) {
  return db.query<never>(
    'update servers set group_id = null, config_revision = config_revision + 1, updated_at = now() where group_id = $1',
    [id],
  )
}

export function renameGroup(db: Db, id: string, name: string) {
  return db.query<GroupRow>(
    `update server_groups g set name=$2 where g.id=$1 returning g.*,
      (select count(*)::int from servers s where s.group_id = g.id) as server_count`,
    [id, name],
  )
}

export function deleteGroup(db: Db, id: string) {
  return db.query<never>('delete from server_groups where id = $1', [id])
}

export function findGroup(db: Db, id: string) {
  return db.query<{ id: string }>('select id from server_groups where id = $1', [id])
}
