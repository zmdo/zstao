-- COS: two role-based buckets (attachments + default) and file operation audit.
create table if not exists cos_buckets (
  role text primary key check (role in ('attachments', 'default')),
  bucket text not null,
  region text not null,
  secret_id text not null,
  secret_key_ciphertext text not null,
  base_prefix text not null default '',
  max_upload_bytes bigint not null default 104857600,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists cos_audit (
  id bigserial primary key,
  session_id text,
  actor text not null default 'console',
  action text not null,
  object_key text not null default '',
  size_bytes bigint,
  ok boolean not null,
  error text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cos_audit_created_idx on cos_audit (created_at desc);
create index if not exists cos_audit_key_idx on cos_audit (object_key);
