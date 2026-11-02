CREATE TABLE server_extension_settings (
 server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 owner text NOT NULL,
 section_key text NOT NULL,
 value jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(server_id, owner, section_key)
);
