-- Harness stays the source of the model configuration. This table follows it.
create table if not exists console_model_profiles (
  provider text primary key,
  settings_ns text not null,
  settings_path jsonb not null,
  display_name text not null,
  config jsonb,
  credential_ref text,
  credential_ciphertext text,
  revision integer not null,
  updated_at timestamptz not null default now()
);
