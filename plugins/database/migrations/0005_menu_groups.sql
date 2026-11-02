-- Named sidebar groups. Item rows point at a group id; an empty group id is ungrouped.
create table if not exists console_menu_group (
  id text primary key,
  title text not null,
  sort integer not null
);

alter table console_menu add column if not exists sort integer not null default 0;
alter table console_menu add column if not exists group_id text not null default '';
alter table console_menu alter column section set default '';

insert into console_menu_group (id, title, sort)
select 'g' || lpad((row_number() over (order by section))::text, 3, '0'), section, (row_number() over (order by section)) - 1
from (select distinct section from console_menu where section <> '') titles
on conflict (id) do nothing;

update console_menu as item
set group_id = grp.id
from console_menu_group as grp
where item.group_id = '' and item.section = grp.title;

delete from console_menu where option_id = 'platform';
