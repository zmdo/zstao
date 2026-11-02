-- Server registration. Existing databases already have these tables, so each statement is a no-op there.
create table if not exists server_groups (
  id uuid primary key,
  name varchar(80) not null,
  created_at timestamptz not null default now(),
  constraint uq_server_groups_name unique (name)
);

create table if not exists ssh_keys (
  id uuid primary key,
  name varchar(80) not null,
  fingerprint varchar(128) not null,
  secret_ciphertext text not null,
  created_at timestamptz not null default now(),
  constraint uq_ssh_keys_fingerprint unique (fingerprint)
);

create table if not exists servers (
  id uuid primary key,
  name varchar(80) not null,
  intranet_host varchar(255) not null,
  ssh_port integer not null default 22,
  ssh_user varchar(64) not null,
  auth_method varchar(32) not null,
  secret_ciphertext text not null,
  ssh_key_id uuid references ssh_keys (id) on delete restrict,
  host_key_fingerprint varchar(128),
  docker_version varchar(64),
  compose_version varchar(64),
  reachability varchar(32) not null default 'unknown',
  last_checked_at timestamptz,
  cpu_cores integer,
  cpu_percent integer,
  mem_total_bytes bigint,
  mem_used_bytes bigint,
  disk_total_bytes bigint,
  disk_used_bytes bigint,
  metrics_at timestamptz,
  region varchar(80),
  group_id uuid references server_groups (id) on delete set null,
  auto_install boolean not null default false,
  install_component_ids text not null default '[]',
  component_status text not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_servers_host_port unique (intranet_host, ssh_port),
  constraint ck_servers_auth_method check (auth_method in ('private_key', 'password')),
  constraint ck_servers_reachability check (reachability in ('online', 'offline', 'docker_unavailable', 'unknown'))
);

create table if not exists server_containers (
  id uuid primary key,
  server_id uuid not null references servers (id) on delete cascade,
  container_id varchar(80) not null,
  name varchar(255) not null,
  image varchar(512) not null,
  status varchar(64) not null,
  ports text not null default '',
  managed boolean not null default false,
  strategy_slug varchar(80),
  observed_at timestamptz not null,
  constraint uq_server_container unique (server_id, container_id)
);

create table if not exists ops_jobs (
  id uuid primary key,
  server_id uuid not null references servers (id) on delete cascade,
  strategy_id uuid,
  action varchar(32) not null,
  status varchar(16) not null default 'queued',
  output_excerpt text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint ck_ops_jobs_action check (action in ('test_connection', 'inspect', 'deploy', 'start', 'stop', 'restart', 'logs', 'install_components')),
  constraint ck_ops_jobs_status check (status in ('queued', 'running', 'succeeded', 'failed'))
);
