export interface WorkspaceGroupsService {
  groupForSession(id: string): Promise<string | undefined>
  register(input: {
    id: string
    label: string
    labelI18n?: { zh?: string; en?: string }
    directory: string
    order?: number
  }): Promise<void>
}

export const SERVER_OPS_GROUP = {
  id: 'server-ops',
  label: '服务器运维',
  labelI18n: { zh: '服务器运维', en: 'Server operations' },
  directory: '.smp/server-ops-workspaces',
  order: 20,
} as const

/** Registers the Harness conversation group owned by this plugin. */
export async function registerServerOpsGroup(groups: Pick<WorkspaceGroupsService, 'register'>): Promise<void> {
  await groups.register(SERVER_OPS_GROUP)
}
