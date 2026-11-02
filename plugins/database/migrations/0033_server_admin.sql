alter table server_audit_log drop constraint if exists server_audit_log_kind_check;
alter table server_audit_log drop constraint if exists server_audit_log_check;
alter table server_audit_log add constraint server_audit_log_kind_check check (kind in ('command','upload','download','transfer','admin'));
alter table server_audit_log alter column server_name drop not null;
alter table server_audit_log alter column host drop not null;
create table server_admin_downloads (
 id uuid primary key, kind text not null check(kind in ('key','audit')),
 target_id uuid, content text, fingerprint text, csrf text,
 expires_at timestamptz not null, consumed_at timestamptz,
 check ((kind='key' and content is null) or kind='audit')
);
create table server_key_rotations (
 id uuid primary key, server_id uuid references servers(id) on delete set null,
 old_key_id uuid references ssh_keys(id) on delete set null,
 new_key_id uuid references ssh_keys(id) on delete set null,
 state text not null check(state in ('prepared','deployed','switched','completed','failed','unknown')),
 phase text not null default 'prepared' check(phase in ('prepared','deployed','switched','completed')),
 config_revision bigint not null, audit_id uuid references server_audit_log(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(state in ('completed','failed') or (server_id is not null and old_key_id is not null and new_key_id is not null and audit_id is not null))
);
create unique index server_key_rotation_active on server_key_rotations(server_id) where state in ('prepared','deployed','switched','unknown');
create table server_audit_retention (
 id boolean primary key default true check(id), days integer not null check(days>=1),
 archive_directory text not null, next_run timestamptz not null, revision bigint not null default 1,
 enabled boolean not null default true, approved_by text not null, approval_id text not null,
 updated_at timestamptz not null default now()
);
