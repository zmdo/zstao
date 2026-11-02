alter table server_groups add column if not exists kind varchar(16) not null default 'user';
alter table server_groups add column if not exists plugin_id text;
alter table server_groups add column if not exists group_key text;
alter table server_groups add column if not exists name_i18n jsonb;
alter table server_groups add column if not exists sort_order integer not null default 0;
alter table server_groups add column if not exists definition jsonb not null default '{}';
alter table server_groups drop constraint if exists uq_server_groups_name;
create unique index if not exists uq_server_groups_user_name on server_groups (name) where kind = 'user';
create unique index if not exists uq_server_groups_plugin_key on server_groups (plugin_id, group_key) where kind = 'system';
alter table server_groups add constraint ck_server_groups_source check (
  (kind = 'user' and plugin_id is null and group_key is null and name_i18n is null)
  or (kind = 'system' and plugin_id is not null and group_key is not null and name_i18n is not null)
);

-- Existing registrations retain their Docker requirements. New registrations default to vacant.
alter table servers add column if not exists type_key text;
update servers set type_key = 'builtin/general' where type_key is null;
update servers set install_component_ids = '["docker","compose"]' where type_key = 'builtin/general';
alter table servers alter column type_key set not null;
alter table servers alter column type_key set default 'builtin/vacant';
alter table servers add column if not exists type_snapshot jsonb;
alter table servers add column if not exists config_revision bigint not null default 0;
alter table servers add column if not exists containers_state varchar(16) not null default 'unknown';
alter table servers add column if not exists containers_checked_at timestamptz;
alter table servers add constraint ck_servers_containers_state check (containers_state in ('unknown', 'ready', 'unavailable', 'error'));
update servers set containers_state = 'ready', containers_checked_at = last_checked_at
where last_checked_at is not null and reachability = 'online';
update servers set reachability = 'online' where reachability = 'docker_unavailable';

alter table ops_jobs add column if not exists config_revision bigint;
alter table ops_jobs add column if not exists type_signature text;
