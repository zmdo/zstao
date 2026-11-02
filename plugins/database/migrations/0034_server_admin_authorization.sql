alter table server_audit_retention
  add column authorization_source text not null default 'user-approval'
  check (authorization_source in ('user-approval', 'full-access'));
