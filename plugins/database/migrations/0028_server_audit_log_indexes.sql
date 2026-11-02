create index if not exists server_audit_log_created
  on server_audit_log (created_at desc, id desc);
create index if not exists server_audit_log_kind_time
  on server_audit_log (kind, created_at desc);
create index if not exists server_audit_log_server_time
  on server_audit_log (server_id, created_at desc);
create index if not exists server_audit_log_actor_time
  on server_audit_log (actor_id, created_at desc);
create index if not exists server_audit_log_session
  on server_audit_log (harness_session_id);
create unique index if not exists server_audit_log_tool_call
  on server_audit_log (harness_session_id, tool_call_id)
  where harness_session_id is not null and tool_call_id is not null;
create index if not exists server_audit_log_root_call
  on server_audit_log (root_tool_call_id)
  where root_tool_call_id is not null;
