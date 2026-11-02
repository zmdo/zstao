-- Preview/materialisation limit for the default bucket (sidebar preview).
alter table cos_buckets
  add column if not exists max_preview_bytes bigint not null default 20971520;
