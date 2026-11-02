-- Cloudflare domains attached to the console. The token is Fernet-encrypted by the database plugin.
create table if not exists domain_manager_domains (
  id uuid primary key,
  name text not null unique,
  zone_id text not null,
  account_name text not null default '',
  status text not null default 'active',
  token_ciphertext text not null,
  created_at timestamptz not null default now()
);

create index if not exists domain_manager_domains_created_idx
  on domain_manager_domains (created_at desc);
