-- DNS change audit written by the Harness tools.
create table if not exists domain_manager_audit (
  id bigserial primary key,
  session_id text,
  tool text not null,
  action text not null,
  domain_id uuid,
  domain_name text not null default '',
  summary text not null default '',
  args jsonb not null default '{}'::jsonb,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists domain_manager_audit_created_idx
  on domain_manager_audit (created_at desc);
