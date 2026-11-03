-- Workspace groups used to resolve relative directories under the container's
-- HOME (/root). The deployment now mounts /srv/workspaces and configures that
-- as the workspace-group root, so move existing records to the same location.
insert into workspace_group_directories (directory, group_id, state)
select replace(directory, '/root/.smp/', '/srv/workspaces/.smp/'), group_id, state
from workspace_group_directories
where directory like '/root/.smp/%'
on conflict (directory) do nothing;

update workspace_group_members
set directory = replace(directory, '/root/.smp/', '/srv/workspaces/.smp/')
where directory like '/root/.smp/%';

delete from workspace_group_directories d
where d.directory like '/root/.smp/%'
  and not exists (
    select 1 from workspace_group_members m where m.directory = d.directory
  );

update console_storage_record
set value = value || jsonb_build_object(
  'path',
  replace(value->>'path', '/root/.smp/', '/srv/workspaces/.smp/')
)
where unit_name = 'workspace'
  and table_name = 'workspaces'
  and value->>'path' like '/root/.smp/%';

update console_session
set header = header || jsonb_build_object(
  'cwd',
  replace(header->>'cwd', '/root/.smp/', '/srv/workspaces/.smp/')
)
where header->>'cwd' like '/root/.smp/%';
