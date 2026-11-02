-- Whether the sidebar starts closed. True keeps the rail until the menu tab says otherwise.
alter table console_site add column if not exists sidebar_collapsed boolean not null default true;
