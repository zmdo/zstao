-- Minimal SMP baseline tables required by the frame plugin on a fresh database.
-- Existing installations created these outside the migration history; IF NOT EXISTS
-- keeps the migration safe for them.
create table if not exists accounts (
  id uuid primary key,
  username text not null unique,
  password_hash text not null,
  totp_enabled boolean not null default false,
  totp_secret text,
  totp_pending_secret text,
  created_at timestamp with time zone not null default now()
);

create table if not exists wallets (
  id uuid primary key,
  ciphertext text not null,
  created_at timestamp with time zone not null default now()
);
