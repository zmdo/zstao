CREATE TABLE server_extension_observations (
 server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 owner text NOT NULL,
 inspection_key text NOT NULL,
 status text NOT NULL CHECK(status IN ('succeeded','failed')),
 result jsonb,
 error jsonb,
 checked_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz,
 last_success_result jsonb,
 config_revision bigint NOT NULL,
 definition_revision text NOT NULL,
 PRIMARY KEY(server_id, owner, inspection_key)
);
