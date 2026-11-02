create table if not exists server_management_settings (
  id integer primary key check (id = 1),
  default_timeout_ms integer not null check (default_timeout_ms > 0),
  max_timeout_ms integer not null check (max_timeout_ms > 0),
  default_command_bytes integer not null check (default_command_bytes > 0),
  max_command_bytes integer not null check (max_command_bytes > 0),
  default_output_bytes integer not null check (default_output_bytes > 0),
  max_output_bytes integer not null check (max_output_bytes > 0),
  updated_by text,
  updated_at timestamptz not null default now()
);
