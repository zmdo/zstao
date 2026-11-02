import type { Db } from '../../database/connection.ts'
import { type GroupRow } from '../../groups/persistence/rows.ts'
import type { UpsertSystemGroupInput } from './inputs.ts'

export function upsertSystemGroup(
  db: Db,
  { id, name, owner, groupKey, nameI18n, order, definition }: UpsertSystemGroupInput,
) {
  return db.query<{ id: string }>(
    `insert into server_groups(id,name,kind,plugin_id,group_key,name_i18n,sort_order,definition)
          values($1,$2,'system',$3,$4,$5,$6,$7) on conflict(plugin_id,group_key) where kind='system'
          do update set name=excluded.name,name_i18n=excluded.name_i18n,sort_order=excluded.sort_order,definition=excluded.definition returning id`,
    [id, name, owner, groupKey, nameI18n, order, definition],
  )
}

export function readGroup(db: Db, id: string) {
  return db.query<GroupRow>('select * from server_groups where id=$1', [id])
}
