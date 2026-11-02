create table if not exists console_session (
  id text primary key,
  header jsonb not null,
  inherited_event_count integer not null,
  revision integer not null,
  event_count integer not null
);

create table if not exists console_session_event (
  session_id text not null references console_session (id),
  seq integer not null,
  event jsonb not null,
  primary key (session_id, seq)
);
