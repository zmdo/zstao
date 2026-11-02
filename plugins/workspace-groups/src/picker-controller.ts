import type { GroupSnapshot, Workspace, WorkspaceSnapshot } from './contract.ts'
import type { GroupStore } from './store.ts'
import { RequestFailure } from './client-api.ts'
import { UNASSIGNED_GROUP_ID } from './rules.ts'

export interface PickerClient {
  store: Pick<GroupStore, 'ready' | 'isEmpty' | 'mainId' | 'groupOf'>
  selectedId(): string
  getSnapshot(): GroupSnapshot
  ctx: { workspaces: { list: { getSnapshot(): WorkspaceSnapshot } } }
  enter(groupId: string, workspaceId: string): Promise<void>
  addWorkspace(groupId: string, path: string): Promise<Workspace>
}

/** The composer belongs to the visible conversation, including while another group is still opening. */
export function pickerGroup(client: PickerClient): string | undefined {
  if (!client.store.ready()) return undefined
  const main = client.store.mainId()
  return !client.store.isEmpty() && main !== undefined ? client.store.groupOf(main) : client.selectedId()
}

export function pickerWorkspaces(client: PickerClient): WorkspaceSnapshot {
  const snapshot = client.ctx.workspaces.list.getSnapshot()
  const groupId = pickerGroup(client)
  const members = client.getSnapshot().members
  return { ...snapshot, ...(groupId === undefined ? { phase: 'pending' as const } : {}), items: snapshot.items.filter(w => members.some(m => m.workspaceId === w.workspaceId && m.groupId === groupId)) }
}

export class PickerController {
  private readonly client: PickerClient
  private targetGroup: string | undefined
  private wasOpen = false
  private created: { workspaceId: string; groupId: string } | undefined
  private creating = false
  constructor(client: PickerClient) { this.client = client }

  observeOpen(open: boolean): void {
    if (open && !this.wasOpen && !this.creating) this.targetGroup = pickerGroup(this.client)
    this.wasOpen = open
  }

  async create(path: string): Promise<Workspace> {
    if (this.creating) throw new RequestFailure('工作区正在创建', 'workspace-group/busy')
    const groupId = this.normal(this.targetGroup)
    this.creating = true
    try {
      const workspace = await this.client.addWorkspace(groupId, path)
      this.member(groupId, workspace.workspaceId)
      this.created = { groupId, workspaceId: workspace.workspaceId }
      return workspace
    } finally { this.creating = false }
  }

  async pick(workspaceId: string): Promise<void> {
    const adopted = this.created?.workspaceId === workspaceId ? this.created : undefined
    this.created = undefined
    const groupId = this.normal(adopted?.groupId ?? this.targetGroup)
    if (adopted === undefined && groupId !== pickerGroup(this.client)) throw new RequestFailure('工作区组已切换，请重新选择工作区', 'workspace-group/picker-stale')
    this.member(groupId, workspaceId)
    await this.client.enter(groupId, workspaceId)
  }

  private normal(id: string | undefined): string {
    if (id === undefined) throw new RequestFailure('工作区归属尚未就绪', 'workspace-group/not-ready')
    if (id === UNASSIGNED_GROUP_ID) throw new RequestFailure('「未归属」不能添加或选择工作区', 'workspace-group/system-readonly')
    if (!this.client.getSnapshot().groups.some(group => group.kind === 'normal' && group.id === id)) throw new RequestFailure('工作区组不可用', 'workspace-group/unknown')
    return id
  }

  private member(groupId: string, workspaceId: string): void {
    const exists = this.client.ctx.workspaces.list.getSnapshot().items.some(w => w.workspaceId === workspaceId)
    const belongs = this.client.getSnapshot().members.some(m => m.workspaceId === workspaceId && m.groupId === groupId)
    if (!exists || !belongs) throw new RequestFailure('工作区已不存在或不属于当前工作区组', 'workspace-group/picker-target')
  }
}
