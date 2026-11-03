-- Dashboard accounts, snapshots, receipts and FX cache.
create table dashboard_accounts (
  id uuid primary key,
  source text not null,
  external_id text not null,
  provider text not null,
  display_name text not null,
  kind text not null default 'other' check (kind in ('cloud', 'llm', 'bank', 'other')),
  currency char(3) not null default 'CNY' check (currency in ('CNY', 'USD')),
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table dashboard_balance_snapshots (
  id uuid primary key,
  account_id uuid not null references dashboard_accounts(id) on delete cascade,
  source text not null,
  external_id text not null,
  amount_minor bigint not null,
  currency char(3) not null default 'CNY' check (currency in ('CNY', 'USD')),
  captured_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index dashboard_balance_latest_idx
  on dashboard_balance_snapshots (account_id, captured_at desc, id desc);

create table dashboard_transactions (
  id uuid primary key,
  source text not null,
  external_id text not null,
  account_id uuid references dashboard_accounts(id) on delete set null,
  kind text not null check (kind in ('income', 'expense')),
  title text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'CNY' check (currency in ('CNY', 'USD')),
  occurred_at timestamptz not null,
  status text not null default 'posted' check (status in ('posted', 'pending', 'void')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index dashboard_transactions_time_idx on dashboard_transactions (occurred_at desc, id desc);
create index dashboard_transactions_kind_time_idx on dashboard_transactions (kind, occurred_at desc);

create table dashboard_fx_rates (
  base char(3) not null check (base in ('CNY', 'USD')),
  quote char(3) not null check (quote in ('CNY', 'USD')),
  rate numeric(18, 8) not null check (rate > 0),
  as_of timestamptz not null,
  fetched_at timestamptz not null default now(),
  source text not null,
  primary key (base, quote)
);
