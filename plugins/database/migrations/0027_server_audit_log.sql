create table if not exists server_audit_log (
  id uuid primary key,
  kind text not null check (kind in ('command','upload','download')),
  server_id uuid references servers(id) on delete set null,
  server_name text not null,
  host text not null,

  actor_id text not null,
  actor_kind text not null,
  harness_session_id text,
  agent_id text,
  harness_turn integer,
  harness_step integer,
  harness_event_seq bigint,
  tool_call_id text,
  root_tool_call_id text,
  parent_tool_call_id text,
  tool_name text not null,

  permission_mode text not null,
  approval_status text not null,
  approval_id text,
  approved_by text,
  approved_at timestamptz,
  approval_reason text,

  command text,
  command_digest text,
  command_length integer check (command_length is null or command_length >= 0),
  command_truncated boolean not null default false,
  redaction_applied boolean not null default false,
  cwd text,

  remote_path text,
  local_path text,
  bytes bigint check (bytes is null or bytes >= 0),
  sha256 text,
  mode text,
  overwrite boolean not null default false,

  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  exit_code integer,
  signal text,
  timed_out boolean not null default false,
  cancelled boolean not null default false,
  error_code text,
  error_message text,

  stdout_excerpt text,
  stderr_excerpt text,
  stdout_bytes bigint,
  stderr_bytes bigint,
  stdout_truncated boolean not null default false,
  stderr_truncated boolean not null default false,
  stdout_digest text,
  stderr_digest text,

  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (
    (kind = 'command' and command is not null and remote_path is null)
    or (kind in ('upload','download') and remote_path is not null and command is null)
  )
);
