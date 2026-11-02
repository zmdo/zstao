import type { Db } from '../../database/connection.ts'
import type { ExecLimits } from '../exec.ts'

interface SettingsRow {
  default_timeout_ms: number
  max_timeout_ms: number
  default_command_bytes: number
  max_command_bytes: number
  default_output_bytes: number
  max_output_bytes: number
  rsync_denied_flags: string[]
  updated_at: Date
}

export function readSettings(db: Db) {
  return db.query<SettingsRow>(
    `select default_timeout_ms,max_timeout_ms,default_command_bytes,max_command_bytes,
       default_output_bytes,max_output_bytes,rsync_denied_flags,updated_at
     from server_management_settings where id=1`,
  )
}

export function writeSettings(db: Db, limits: ExecLimits, updatedBy: string) {
  return db.query<SettingsRow>(
    `insert into server_management_settings(
       id,default_timeout_ms,max_timeout_ms,default_command_bytes,max_command_bytes,
       default_output_bytes,max_output_bytes,rsync_denied_flags,updated_by,updated_at
     ) values(1,$1,$2,$3,$4,$5,$6,$7,$8,now())
     on conflict (id) do update set
       default_timeout_ms=excluded.default_timeout_ms,
       max_timeout_ms=excluded.max_timeout_ms,
       default_command_bytes=excluded.default_command_bytes,
       max_command_bytes=excluded.max_command_bytes,
       default_output_bytes=excluded.default_output_bytes,
       max_output_bytes=excluded.max_output_bytes,
       rsync_denied_flags=excluded.rsync_denied_flags,
       updated_by=excluded.updated_by,
       updated_at=now()
     returning default_timeout_ms,max_timeout_ms,default_command_bytes,max_command_bytes,
       default_output_bytes,max_output_bytes,rsync_denied_flags,updated_at`,
    [
      limits.defaultTimeoutMs,
      limits.maxTimeoutMs,
      limits.defaultCommandBytes,
      limits.maxCommandBytes,
      limits.defaultOutputBytes,
      limits.maxOutputBytes,
      JSON.stringify(limits.rsyncDeniedFlags),
      updatedBy,
    ],
  )
}
