drop table if exists workspace_group_focus;
drop table if exists workspace_group_members;

create table workspace_group_directories (
  directory text primary key,
  group_id text not null check (group_id <> 'unassigned'),
  state text not null check (state in ('pending', 'ready'))
);

create table workspace_group_members (
  workspace_id text primary key,
  group_id text not null check (group_id <> 'unassigned'),
  directory text not null references workspace_group_directories (directory),
  is_default boolean not null default false,
  last_session_id text
);

create unique index workspace_group_one_default on workspace_group_members (group_id) where is_default;

create table workspace_group_focus (
  group_id text primary key,
  workspace_id text,
  session_id text,
  check (group_id <> 'unassigned' or workspace_id is null)
);
