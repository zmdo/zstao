create table if not exists workspace_group_members (
  workspace_id text primary key,
  group_id text not null,
  is_default boolean not null default false
);

create table if not exists workspace_group_focus (
  group_id text primary key,
  workspace_id text not null
);
