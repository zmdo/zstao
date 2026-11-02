-- One row for the browser title and icon. An empty icon keeps the harness favicon.
create table if not exists console_site (
  id boolean primary key default true check (id),
  title text not null default '',
  icon text not null default ''
);

insert into console_site (id, title, icon)
values (true, '', '')
on conflict (id) do nothing;
