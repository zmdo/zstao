-- V2 完整模型设计稿，仅供空的隔离 schema 验证；不是运行时迁移。
-- 分阶段启用、开发库重建边界和应用层约束见 data-model.md。
-- UUID 由宿主产生，不依赖 uuid-ossp；所有名称按连接的 search_path 解析。

CREATE TABLE server_groups (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('user', 'system')),
  name text,
  plugin_id text,
  group_key text,
  name_i18n jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  definition_snapshot jsonb,
  definition_revision text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'user' AND name IS NOT NULL AND length(btrim(name)) > 0 AND plugin_id IS NULL AND group_key IS NULL)
    OR (kind = 'system' AND plugin_id IS NOT NULL AND group_key IS NOT NULL AND name_i18n IS NOT NULL AND definition_snapshot IS NOT NULL AND definition_revision IS NOT NULL)),
  CHECK (name_i18n IS NULL OR jsonb_typeof(name_i18n) = 'object'),
  CHECK (definition_snapshot IS NULL OR jsonb_typeof(definition_snapshot) = 'object')
);
CREATE UNIQUE INDEX server_groups_user_name ON server_groups (name) WHERE kind = 'user';
CREATE UNIQUE INDEX server_groups_plugin_key ON server_groups (plugin_id, group_key) WHERE kind = 'system';

CREATE TABLE ssh_keys (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  fingerprint text NOT NULL UNIQUE,
  secret_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE server_software_policies (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  software_key text NOT NULL,
  restriction jsonb NOT NULL DEFAULT '{"kind":"any"}'::jsonb CHECK (jsonb_typeof(restriction) = 'object'),
  detect_updates boolean NOT NULL DEFAULT false,
  policy_revision bigint NOT NULL DEFAULT 1 CHECK (policy_revision > 0),
  reminder_after timestamptz,
  last_check_at timestamptz,
  next_check_at timestamptz,
  check_error jsonb,
  check_snapshot jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, software_key),
  CHECK (detect_updates OR next_check_at IS NULL)
);
CREATE INDEX server_software_detection_due ON server_software_policies (next_check_at, server_id)
  WHERE detect_updates AND next_check_at IS NOT NULL;

CREATE TABLE server_upgrade_suggestions (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  software_key text NOT NULL,
  target_identity text NOT NULL,
  product_version text NOT NULL,
  candidate_snapshot jsonb NOT NULL CHECK (jsonb_typeof(candidate_snapshot) = 'object'),
  basis_snapshot jsonb NOT NULL CHECK (jsonb_typeof(basis_snapshot) = 'object'),
  validity text NOT NULL CHECK (validity IN ('eligible', 'blocked', 'obsolete', 'satisfied')),
  reason jsonb,
  decision text NOT NULL DEFAULT 'none' CHECK (decision IN ('none', 'rejected')),
  decision_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, software_key, target_identity),
  CHECK (decision <> 'rejected' OR decision_at IS NOT NULL)
);
CREATE INDEX server_upgrade_suggestions_filter ON server_upgrade_suggestions (validity, decision, software_key, server_id);

CREATE TABLE server_change_plans (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('prepare', 'move', 'upgrade')),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'awaiting_confirmation', 'scheduled', 'running', 'paused', 'completed', 'partial_failure', 'cancelled', 'missed', 'blocked')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  confirmation_digest text,
  confirmed_by text,
  confirmed_at timestamptz,
  authorization_kind text CHECK (authorization_kind IN ('explicit', 'missing_software_only')),
  window_start timestamptz,
  window_end timestamptz,
  timezone text,
  concurrency integer NOT NULL DEFAULT 1 CHECK (concurrency > 0),
  failure_policy text NOT NULL DEFAULT 'pause_pending' CHECK (failure_policy = 'pause_pending'),
  request_snapshot jsonb NOT NULL CHECK (jsonb_typeof(request_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((window_start IS NULL AND window_end IS NULL AND timezone IS NULL)
    OR (window_start IS NOT NULL AND window_end IS NOT NULL AND timezone IS NOT NULL AND window_end > window_start)),
  CHECK (confirmed_at IS NULL OR (confirmation_digest IS NOT NULL AND confirmed_by IS NOT NULL AND authorization_kind IS NOT NULL AND window_start IS NOT NULL)),
  CHECK (state NOT IN ('scheduled', 'running', 'completed', 'partial_failure', 'missed') OR confirmed_at IS NOT NULL),
  CHECK (authorization_kind IS DISTINCT FROM 'missing_software_only' OR kind = 'prepare')
);
CREATE INDEX server_change_plans_due ON server_change_plans (window_start, id) WHERE state = 'scheduled';

CREATE TABLE server_change_targets (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES server_change_plans(id) ON DELETE RESTRICT,
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  server_identity uuid NOT NULL, -- 保留历史身份；删除登记后不丢失执行记录
  server_snapshot jsonb NOT NULL CHECK (jsonb_typeof(server_snapshot) = 'object'),
  expected_config_revision bigint NOT NULL CHECK (expected_config_revision > 0),
  expected_environment_revision bigint NOT NULL CHECK (expected_environment_revision >= 0),
  definition_revision text NOT NULL,
  target_snapshot jsonb NOT NULL CHECK (jsonb_typeof(target_snapshot) = 'object'),
  preflight_state text NOT NULL DEFAULT 'ready' CHECK (preflight_state IN ('queued', 'ready', 'failed')),
  preflight_error jsonb,
  mutation_started_at timestamptz,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'blocked', 'cancelled', 'skipped')),
  result jsonb,
  finished_at timestamptz,
  UNIQUE (plan_id, server_identity),
  CHECK (server_id IS NULL OR server_id = server_identity)
);
CREATE INDEX server_change_targets_pending ON server_change_targets (plan_id, state, id);
CREATE INDEX server_change_targets_server ON server_change_targets (server_identity, plan_id);

CREATE TABLE server_jobs (
  id uuid PRIMARY KEY,
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  server_identity uuid NOT NULL,
  target_id uuid REFERENCES server_change_targets(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('inspect', 'detect_updates', 'apply_plan')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'claimed', 'running', 'recovering', 'succeeded', 'failed', 'blocked', 'cancelled')),
  phase text NOT NULL DEFAULT 'waiting' CHECK (phase IN ('waiting', 'connecting', 'preflight', 'installing', 'replacing', 'upgrading', 'verifying', 'committing', 'reconciling', 'finished')),
  mutation_phase text CHECK (mutation_phase IN ('installing', 'replacing', 'upgrading')),
  expected_config_revision bigint NOT NULL CHECK (expected_config_revision > 0),
  expected_environment_revision bigint NOT NULL CHECK (expected_environment_revision >= 0),
  definition_revision text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  idempotency_key text NOT NULL UNIQUE,
  operation_id uuid NOT NULL UNIQUE,
  worker_id text,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  request_snapshot jsonb NOT NULL CHECK (jsonb_typeof(request_snapshot) = 'object'),
  result jsonb,
  output_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CHECK (server_id IS NULL OR server_id = server_identity),
  CHECK ((purpose = 'apply_plan' AND target_id IS NOT NULL) OR (purpose = 'inspect' AND target_id IS NOT NULL AND request_snapshot->>'action' IN ('preflight_move', 'preflight_upgrade'))
    OR (purpose <> 'apply_plan' AND target_id IS NULL)),
  CHECK (state NOT IN ('queued', 'claimed', 'running', 'recovering') OR server_id IS NOT NULL),
  CHECK (state NOT IN ('claimed', 'running', 'recovering') OR (worker_id IS NOT NULL AND fence > 0 AND lease_expires_at IS NOT NULL)),
  CHECK (purpose = 'apply_plan' OR (mutation_phase IS NULL AND phase NOT IN ('installing', 'replacing', 'upgrading', 'committing'))),
  CHECK (state NOT IN ('succeeded', 'failed', 'blocked', 'cancelled') OR finished_at IS NOT NULL)
);
CREATE UNIQUE INDEX server_jobs_one_active_per_server ON server_jobs (server_id)
  WHERE state IN ('claimed', 'running', 'recovering');
CREATE UNIQUE INDEX server_jobs_target_attempt ON server_jobs (target_id, attempt) WHERE target_id IS NOT NULL AND purpose = 'apply_plan';
CREATE INDEX server_jobs_queue ON server_jobs (created_at, id) WHERE state = 'queued';
CREATE INDEX server_jobs_expired ON server_jobs (lease_expires_at) WHERE state IN ('claimed', 'running', 'recovering');
CREATE INDEX server_jobs_history ON server_jobs (server_identity, created_at DESC, id);

CREATE TABLE server_job_steps (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES server_jobs(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  software_key text,
  phase text NOT NULL CHECK (phase IN ('connecting', 'preflight', 'installing', 'replacing', 'upgrading', 'verifying', 'committing', 'reconciling')),
  state text NOT NULL CHECK (state IN ('running', 'succeeded', 'failed', 'unknown', 'skipped')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  error jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (job_id, ordinal),
  CHECK (state = 'running' OR finished_at IS NOT NULL)
);

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
