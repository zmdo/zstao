-- China ICP filing flag. Only filed domains may be used with mainland China servers.
alter table domain_manager_domains
  add column if not exists filed boolean not null default false;
