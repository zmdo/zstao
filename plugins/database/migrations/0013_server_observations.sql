-- A1: rebuild empty server tables; preserve groups, SSH keys and all other modules.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM servers) OR EXISTS (SELECT 1 FROM ops_jobs) OR EXISTS (SELECT 1 FROM server_containers) THEN
    RAISE EXCEPTION 'Server model rebuild requires empty server tables; existing data was not deleted';
  END IF;
END $$;
DROP TABLE ops_jobs;
DROP TABLE server_containers;
DROP TABLE servers;
-- Cached type shapes are derived data. Providers republish the OS-aware definitions on load.
UPDATE server_groups SET definition='{}'::jsonb WHERE kind='system';

CREATE TABLE servers (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  host text NOT NULL CHECK (length(btrim(host)) > 0),
  ssh_port integer NOT NULL DEFAULT 22 CHECK (ssh_port BETWEEN 1 AND 65535),
  ssh_user text NOT NULL CHECK (length(btrim(ssh_user)) > 0),
  auth_method text NOT NULL CHECK (auth_method IN ('password', 'private_key')),
  secret_ciphertext text,
  ssh_key_id uuid REFERENCES ssh_keys(id) ON DELETE RESTRICT,
  host_fingerprint text,
  region text NOT NULL DEFAULT '',
  group_id uuid REFERENCES server_groups(id) ON DELETE RESTRICT,
  type_key text NOT NULL,
  type_snapshot jsonb NOT NULL CHECK (jsonb_typeof(type_snapshot) = 'object'),
  type_revision text NOT NULL,
  declared_os jsonb NOT NULL CHECK (jsonb_typeof(declared_os) = 'object'),
  install_required_software boolean NOT NULL DEFAULT false,
  config_revision bigint NOT NULL DEFAULT 1 CHECK (config_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host, ssh_port),
  CHECK ((auth_method = 'password' AND secret_ciphertext IS NOT NULL AND ssh_key_id IS NULL)
    OR (auth_method = 'private_key' AND secret_ciphertext IS NULL AND ssh_key_id IS NOT NULL))
);
CREATE INDEX servers_group_page ON servers (group_id, name, id);

CREATE TABLE server_runtime (
  server_id uuid PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  connection_state text NOT NULL DEFAULT 'unknown' CHECK (connection_state IN ('unknown', 'online', 'offline')),
  connection_error jsonb,
  connection_checked_at timestamptz,
  os_probe_state text NOT NULL DEFAULT 'unknown' CHECK (os_probe_state IN ('unknown', 'detected', 'failed')),
  detected_os jsonb CHECK (detected_os IS NULL OR jsonb_typeof(detected_os) = 'object'),
  os_error jsonb,
  os_checked_at timestamptz,
  os_last_success_at timestamptz,
  observed_config_revision bigint NOT NULL DEFAULT 0,
  environment_revision bigint NOT NULL DEFAULT 0 CHECK (environment_revision >= 0),
  cpu_cores integer CHECK (cpu_cores > 0),
  cpu_percent numeric CHECK (cpu_percent BETWEEN 0 AND 100),
  memory_total_bytes bigint CHECK (memory_total_bytes >= 0),
  memory_used_bytes bigint CHECK (memory_used_bytes >= 0),
  disk_total_bytes bigint CHECK (disk_total_bytes >= 0),
  disk_used_bytes bigint CHECK (disk_used_bytes >= 0),
  metrics_sampled_at timestamptz,
  metrics_error jsonb,
  CHECK (os_probe_state <> 'detected' OR (detected_os IS NOT NULL AND os_last_success_at IS NOT NULL)),
  CHECK (memory_used_bytes IS NULL OR memory_total_bytes IS NULL OR memory_used_bytes <= memory_total_bytes),
  CHECK (disk_used_bytes IS NULL OR disk_total_bytes IS NULL OR disk_used_bytes <= disk_total_bytes)
);

CREATE TABLE server_software_observations (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  software_key text NOT NULL,
  probe_state text NOT NULL CHECK (probe_state IN ('installed', 'missing', 'unknown')),
  checked_at timestamptz NOT NULL,
  error jsonb,
  observed_config_revision bigint NOT NULL CHECK (observed_config_revision > 0),
  observed_environment_revision bigint NOT NULL CHECK (observed_environment_revision >= 0),
  recipe_key text NOT NULL,
  recipe_revision text NOT NULL,
  last_known_state text CHECK (last_known_state IN ('installed', 'missing')),
  product_version text,
  target_identity text,
  packages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(packages) = 'array'),
  healthy boolean,
  last_success_at timestamptz,
  PRIMARY KEY (server_id, software_key),
  CHECK (COALESCE((last_known_state IS NULL AND last_success_at IS NULL AND product_version IS NULL AND target_identity IS NULL)
    OR (last_known_state = 'missing' AND last_success_at IS NOT NULL AND product_version IS NULL AND target_identity IS NULL)
    OR (last_known_state = 'installed' AND last_success_at IS NOT NULL AND product_version IS NOT NULL AND target_identity IS NOT NULL), false)),
  CHECK (probe_state = 'unknown' OR (last_known_state IS NOT NULL AND probe_state = last_known_state))
);
CREATE INDEX server_software_by_product ON server_software_observations (software_key, product_version, server_id);

CREATE TABLE server_container_scans (
  server_id uuid PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('ready', 'unavailable', 'unknown', 'failed')),
  checked_at timestamptz NOT NULL,
  last_success_at timestamptz,
  error jsonb,
  CHECK (state <> 'ready' OR last_success_at IS NOT NULL)
);

CREATE TABLE server_containers (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  container_id text NOT NULL,
  name text NOT NULL,
  image text NOT NULL,
  status text NOT NULL,
  ports text NOT NULL DEFAULT '',
  managed boolean NOT NULL DEFAULT false,
  strategy_slug text,
  observed_at timestamptz NOT NULL,
  UNIQUE (server_id, container_id)
);

-- Existing job runner is replaced in the following plan/executor stage.
create table ops_jobs (
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

alter table ops_jobs add column config_revision bigint;
alter table ops_jobs add column type_signature text;
