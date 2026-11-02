import { randomUUID } from 'node:crypto'
import type { Db, DbClient } from '@smp/console-server-management/contracts'
import type { Container, ContainerSnapshot } from '../model.ts'

/** The core passes its fenced transaction; details and observation commit together. */
export async function replaceContainers(db: DbClient, serverId: string, containers: Container[]): Promise<void> {
  await db.query('delete from server_containers where server_id=$1', [serverId])
  for (const item of containers)
    await db.query(
      'insert into server_containers(id,server_id,container_id,name,image,status,ports,managed,strategy_slug,observed_at) values($1,$2,$3,$4,$5,$6,$7,false,null,now())',
      [randomUUID(), serverId, item.container_id, item.name, item.image, item.status, item.ports],
    )
}

/** One statement reads the list and its observation metadata from the same database snapshot. */
export async function containerSnapshot(db: Pick<Db, 'query'>, serverId: string): Promise<ContainerSnapshot> {
  const result = await db.query<ContainerSnapshot>(
    `select coalesce((select jsonb_agg(jsonb_build_object('container_id',container_id,'name',name,'image',image,'status',status,'ports',ports) order by name)
       from server_containers where server_id=$1),'[]'::jsonb) as rows,
       status,checked_at::text,last_success_at::text,error
     from server_extension_observations where server_id=$1 and owner='@smp/console-server-containers'
       and inspection_key='@smp/console-server-containers/container-check'`, [serverId],
  )
  return result.rows[0] ?? { rows: [], status: null, checked_at: null, last_success_at: null, error: null }
}

export async function requireContainerSchema(db: Pick<Db, 'query'>): Promise<void> {
  const required = ['0019_server_extension_observations.sql', '0021_container_plugin_observations.sql']
  const applied = await db.query<{ id: string }>(
    'select id from console_schema_migrations where id=any($1::text[])', [required],
  )
  const missing = required.filter((id) => !applied.rows.some((row) => row.id === id))
  if (missing.length) throw new Error(`Container plugin requires database migrations: ${missing.join(', ')}`)
}
