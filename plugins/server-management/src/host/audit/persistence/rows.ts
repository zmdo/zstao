export interface AuditRecordRow {
  id: string
  kind: 'command' | 'upload' | 'download' | 'transfer' | 'admin'
  server_id: string | null
  server_name: string | null
  current_server_name: string | null
  host: string | null
  actor_id: string
  actor_kind: string
  harness_session_id: string | null
  agent_id: string | null
  harness_turn: number | null
  harness_step: number | null
  harness_event_seq: string | null
  tool_call_id: string | null
  root_tool_call_id: string | null
  parent_tool_call_id: string | null
  tool_name: string
  permission_mode: string
  approval_status: string
  approval_id: string | null
  approved_by: string | null
  approved_at: Date | null
  approval_reason: string | null
  command: string
  command_digest: string
  command_length: number
  command_truncated: boolean
  redaction_applied: boolean
  cwd: string | null
  remote_path: string | null
  local_path: string | null
  bytes: string | null
  mode: string | null
  overwrite: boolean
  status: string
  started_at: Date
  finished_at: Date | null
  duration_ms: number | null
  exit_code: number | null
  signal: string | null
  timed_out: boolean
  cancelled: boolean
  error_code: string | null
  error_message: string | null
  stdout_excerpt: string | null
  stderr_excerpt: string | null
  stdout_bytes: string | null
  stderr_bytes: string | null
  stdout_truncated: boolean
  stderr_truncated: boolean
  stdout_digest: string | null
  stderr_digest: string | null
  metadata: Record<string, unknown>
  created_at: Date
}
