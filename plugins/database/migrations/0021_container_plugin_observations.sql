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
