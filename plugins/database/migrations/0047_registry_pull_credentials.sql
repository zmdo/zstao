-- Generic host configuration actions share the existing server queue and leases.
alter table server_jobs drop constraint server_jobs_purpose_check;
alter table server_jobs add constraint server_jobs_purpose_check check (purpose in ('inspect','detect_updates','apply_plan','configure'));
create sequence server_configuration_sequence;

-- No credential material is stored in jobs or associations.
create table application_registry_bindings (
  server_identity uuid primary key,
  server_id uuid references servers(id) on delete set null,
  credential_id text not null,
  registry text not null,
  repositories jsonb not null default '[]',
  desired_revision bigint not null,
  applied_revision bigint,
  generation text,
  last_error text,
  config_revision bigint,
  state text not null default 'pending' check (state in ('pending','synced','failed','cleanup_pending','removed','orphaned')),
  active boolean not null default true,
  job_id uuid references server_jobs(id) on delete set null,
  retry_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table application_registry_clients (
  id uuid primary key,
  name text not null,
  token_hash text not null unique,
  server_ids jsonb not null,
  repositories jsonb not null,
  created_at timestamptz not null default now()
);
create table application_registry_requests (
  client_id uuid not null references application_registry_clients(id) on delete cascade,
  request_id text not null,
  server_identity uuid not null,
  image text not null,
  job_id uuid references server_jobs(id) on delete set null,
  deployment_job_id uuid references server_jobs(id) on delete set null,
  pull_result jsonb,
  reported_at timestamptz,
  primary key(client_id, request_id)
);
