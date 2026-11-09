import type { Db } from '../../database/connection.ts'
import type { Json } from '../../../../shared/contracts/common.ts'

export function lockServer(db: Db, id: string) {
  return db.query<{ config_revision: string; environment_revision: string }>(
    'select s.config_revision,r.environment_revision from servers s join server_runtime r on r.server_id=s.id where s.id=$1 for update of s', [id])
}
export function existing(db: Db, key: string) {
  return db.query<{ id: string; server_id: string; state: string; result: Json; request_snapshot: { input: Json } }>('select * from server_jobs where idempotency_key=$1', [key])
}
export function insert(db: Db, input: { id: string; serverId: string; configRevision: string; environmentRevision: string; key: string; operationId: string; snapshot: string }) {
  return db.query<never>(`insert into server_jobs(id,server_id,server_identity,purpose,expected_config_revision,expected_environment_revision,definition_revision,idempotency_key,operation_id,request_snapshot)
    values($1,$2,$2,'configure',$3,$4,'',$5,$6,$7::jsonb || jsonb_build_object('sequence',nextval('server_configuration_sequence')::text))`,
    [input.id, input.serverId, input.configRevision, input.environmentRevision, input.key, input.operationId, input.snapshot])
}
export function task(db: Db, id: string) {
  return db.query<{ id: string; server_identity: string; state: string; result: Json }>("select id,server_identity,state,result from server_jobs where id=$1 and purpose='configure'", [id])
}
