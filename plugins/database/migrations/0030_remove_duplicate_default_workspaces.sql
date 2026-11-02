-- Older builds auto-assigned every discovered workspace to the general group.
-- Keep the group's real default and leave other default-workspace entries
-- unassigned until a user explicitly claims them.
delete from workspace_group_focus f
using workspace_group_members m
where f.workspace_id = m.workspace_id
  and m.group_id = 'general'
  and m.is_default = false
  and m.directory like '%/default-workspace';

delete from workspace_group_members
where group_id = 'general'
  and is_default = false
  and directory like '%/default-workspace';

delete from workspace_group_directories d
where d.group_id = 'general'
  and d.directory like '%/default-workspace'
  and not exists (
    select 1 from workspace_group_members m where m.directory = d.directory
  );

create unique index if not exists workspace_group_members_one_default
  on workspace_group_members (group_id)
  where is_default;
