-- Cloudflare account that owns each attached domain.
alter table domain_manager_domains
  add column if not exists account_id text not null default '';
