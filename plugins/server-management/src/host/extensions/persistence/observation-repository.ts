import type { Db } from '../../database/connection.ts'
import type { Json } from '../../../shared/contracts/common.ts'

export function saveExtensionObservation(
  db: Db,
  input: {
    serverId: string
    owner: string
    key: string
    status: 'succeeded' | 'failed'
    result: Json | null
    error: Json | null
    configRevision: string
    definitionRevision: string
  },
) {
  return db.query<never>(
    `insert into server_extension_observations
       (server_id,owner,inspection_key,status,result,error,checked_at,last_success_at,last_success_result,config_revision,definition_revision)
     values($1,$2,$3,$4,$5,$6,now(),case when $4='succeeded' then now() else null end,
       case when $4='succeeded' then $5::jsonb else null end,$7,$8)
     on conflict(server_id,owner,inspection_key) do update set
       status=excluded.status,result=excluded.result,error=excluded.error,checked_at=excluded.checked_at,
       last_success_at=coalesce(excluded.last_success_at,server_extension_observations.last_success_at),
       last_success_result=coalesce(excluded.last_success_result,server_extension_observations.last_success_result),
       config_revision=excluded.config_revision,definition_revision=excluded.definition_revision`,
    [
      input.serverId,
      input.owner,
      input.key,
      input.status,
      input.result === null ? null : JSON.stringify(input.result),
      input.error === null ? null : JSON.stringify(input.error),
      input.configRevision,
      input.definitionRevision,
    ],
  )
}

export function extensionObservations(db: Db, serverId: string) {
  return db.query<never>(
    'select owner,inspection_key,status,result,error,checked_at,last_success_at,last_success_result from server_extension_observations where server_id=$1 order by owner,inspection_key',
    [serverId],
  )
}
