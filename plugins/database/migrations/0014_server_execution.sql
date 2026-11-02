-- The server module has no released data. Never discard unexpected job history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ops_jobs) THEN RAISE EXCEPTION 'server execution rebuild requires empty ops_jobs'; END IF;
END $$;
DROP TABLE ops_jobs;
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
  CHECK ((purpose = 'apply_plan' AND target_id IS NOT NULL) OR (purpose <> 'apply_plan' AND target_id IS NULL)),
  CHECK (state NOT IN ('queued', 'claimed', 'running', 'recovering') OR server_id IS NOT NULL),
  CHECK (state NOT IN ('claimed', 'running', 'recovering') OR (worker_id IS NOT NULL AND fence > 0 AND lease_expires_at IS NOT NULL)),
  CHECK (purpose = 'apply_plan' OR (mutation_phase IS NULL AND phase NOT IN ('installing', 'replacing', 'upgrading', 'committing'))),
  CHECK (state NOT IN ('succeeded', 'failed', 'blocked', 'cancelled') OR finished_at IS NOT NULL)
);
CREATE UNIQUE INDEX server_jobs_one_active_per_server ON server_jobs (server_id)
  WHERE state IN ('claimed', 'running', 'recovering');
CREATE UNIQUE INDEX server_jobs_target_attempt ON server_jobs (target_id, attempt) WHERE target_id IS NOT NULL;
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
