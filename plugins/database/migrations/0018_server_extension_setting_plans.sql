CREATE TABLE server_extension_setting_proposals (
 id uuid PRIMARY KEY,
 server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 owner text NOT NULL,
 section_key text NOT NULL,
 value jsonb NOT NULL,
 expected_revision bigint NOT NULL CHECK(expected_revision >= 0),
 digest text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied','cancelled','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 applied_revision bigint,
 applied_at timestamptz,
 CHECK(state <> 'applied' OR (applied_revision IS NOT NULL AND applied_at IS NOT NULL))
);
CREATE INDEX server_extension_setting_proposals_pending
 ON server_extension_setting_proposals(server_id,owner,section_key,expires_at)
 WHERE state='pending';
