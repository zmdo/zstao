-- Free-form note that explains what each attached domain is used for.
alter table domain_manager_domains
  add column if not exists description text not null default '';
