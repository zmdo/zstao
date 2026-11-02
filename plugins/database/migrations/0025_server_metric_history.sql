create table if not exists server_metric_samples (
  id bigserial primary key,
  server_id uuid not null references servers(id) on delete cascade,
  sampled_at timestamptz not null default now(),
  cpu_percent numeric(5,2) not null check (cpu_percent between 0 and 100),
  memory_used_bytes bigint not null check (memory_used_bytes >= 0),
  memory_total_bytes bigint not null check (memory_total_bytes > 0),
  disk_used_bytes bigint not null check (disk_used_bytes >= 0),
  disk_total_bytes bigint not null check (disk_total_bytes > 0)
);
create index if not exists server_metric_samples_server_time
  on server_metric_samples (server_id, sampled_at desc);
create index if not exists server_metric_samples_time
  on server_metric_samples (sampled_at);

create table if not exists server_metric_rollups_5m (
  server_id uuid not null references servers(id) on delete cascade,
  bucket_start timestamptz not null,
  cpu_avg numeric(5,2) not null,
  cpu_max numeric(5,2) not null,
  memory_avg numeric(5,2) not null,
  memory_max numeric(5,2) not null,
  disk_avg numeric(5,2) not null,
  disk_max numeric(5,2) not null,
  sample_count integer not null,
  primary key (server_id, bucket_start)
);
create index if not exists server_metric_rollups_5m_time
  on server_metric_rollups_5m (bucket_start);

create table if not exists server_metric_rollups_1h (
  server_id uuid not null references servers(id) on delete cascade,
  bucket_start timestamptz not null,
  cpu_avg numeric(5,2) not null,
  cpu_max numeric(5,2) not null,
  memory_avg numeric(5,2) not null,
  memory_max numeric(5,2) not null,
  disk_avg numeric(5,2) not null,
  disk_max numeric(5,2) not null,
  sample_count integer not null,
  primary key (server_id, bucket_start)
);
create index if not exists server_metric_rollups_1h_time
  on server_metric_rollups_1h (bucket_start);
