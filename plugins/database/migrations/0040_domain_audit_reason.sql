-- Why the AI made a DNS change, written by the write tools.
alter table domain_manager_audit
  add column if not exists reason text not null default '';
