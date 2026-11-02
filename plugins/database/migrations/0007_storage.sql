create table if not exists console_storage_unit (
  name text primary key,
  version integer not null
);

create table if not exists console_storage_record (
  unit_name text not null references console_storage_unit (name),
  table_name text not null,
  record_key text not null,
  value jsonb not null,
  primary key (unit_name, table_name, record_key)
);

create table if not exists console_storage_global (
  unit_name text primary key references console_storage_unit (name),
  value jsonb not null
);
