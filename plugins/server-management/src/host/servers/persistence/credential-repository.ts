import type { Db } from '../../database/connection.ts'
import type { ServerSecret } from './rows.ts'

export async function serverSecret(db: Db, id: string): Promise<ServerSecret | undefined> {
  const result = await db.query<ServerSecret>(
    `select s.id, s.host, s.ssh_port, s.ssh_user, s.auth_method,
            case when s.auth_method = 'private_key' then k.secret_ciphertext else s.secret_ciphertext end as secret_ciphertext,
            s.host_fingerprint, s.install_required_software, s.declared_os, r.detected_os, r.os_probe_state, r.observed_config_revision, r.environment_revision, s.group_id, s.type_key, s.config_revision, s.internal_host
     from servers s join server_runtime r on r.server_id=s.id left join ssh_keys k on k.id = s.ssh_key_id where s.id = $1`,
    [id],
  )
  return result.rows[0]
}
