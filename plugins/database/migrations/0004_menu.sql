-- Sidebar section titles chosen on the menu tab. A missing row keeps the default.
create table if not exists console_menu (
  option_id text primary key,
  section text not null default ''
);
