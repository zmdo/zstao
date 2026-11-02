CREATE TABLE server_software_policies (
 server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 software_key text NOT NULL,
 restriction jsonb NOT NULL DEFAULT '{"kind":"any"}'::jsonb CHECK(jsonb_typeof(restriction)='object'),
 detect_updates boolean NOT NULL DEFAULT false,
 policy_revision bigint NOT NULL DEFAULT 1 CHECK(policy_revision>0),
 reminder_after timestamptz, last_check_at timestamptz, next_check_at timestamptz,
 check_error jsonb, check_snapshot jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(server_id,software_key), CHECK(detect_updates OR next_check_at IS NULL)
);
CREATE INDEX server_software_detection_due ON server_software_policies(next_check_at,server_id) WHERE detect_updates;
CREATE TABLE server_upgrade_suggestions (
 id uuid PRIMARY KEY, server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 software_key text NOT NULL, target_identity text NOT NULL, product_version text NOT NULL,
 candidate_snapshot jsonb NOT NULL, basis_snapshot jsonb NOT NULL,
 validity text NOT NULL CHECK(validity IN ('eligible','blocked','obsolete','satisfied')),
 reason jsonb, decision text NOT NULL DEFAULT 'none' CHECK(decision IN ('none','rejected')),
 decision_at timestamptz, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(server_id,software_key,target_identity), CHECK(decision<>'rejected' OR decision_at IS NOT NULL)
);
CREATE INDEX server_upgrade_suggestions_filter ON server_upgrade_suggestions(validity,decision,software_key,server_id);
ALTER TABLE server_change_targets ADD COLUMN preflight_state text NOT NULL DEFAULT 'ready' CHECK(preflight_state IN ('queued','ready','failed'));
ALTER TABLE server_change_targets ADD COLUMN preflight_error jsonb;
ALTER TABLE server_change_targets ADD COLUMN mutation_started_at timestamptz;
ALTER TABLE server_jobs DROP CONSTRAINT server_jobs_check1;
ALTER TABLE server_jobs ADD CONSTRAINT server_jobs_target_purpose CHECK (
 (purpose='apply_plan' AND target_id IS NOT NULL)
 OR (purpose='inspect' AND target_id IS NOT NULL AND request_snapshot->>'action' IN ('preflight_move','preflight_upgrade'))
 OR (purpose<>'apply_plan' AND target_id IS NULL)
);
DROP INDEX server_jobs_target_attempt;
CREATE UNIQUE INDEX server_jobs_target_attempt ON server_jobs(target_id,attempt) WHERE target_id IS NOT NULL AND purpose='apply_plan';
