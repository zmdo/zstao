alter table server_runtime add column if not exists auto_retry_at timestamptz;
alter table server_runtime add column if not exists auto_retry_attempts integer not null default 0;
