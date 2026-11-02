import { GENERAL_GROUP_ID, groupForSession, pagesHidden, sessionWorkspaceGroup } from './rules.ts'
import type { Focus, GroupSnapshot, ListSource, SessionSnapshot, WorkspaceSnapshot } from './contract.ts'
export type { GroupSnapshot } from './contract.ts'

export const EMPTY_SNAPSHOT: GroupSnapshot = { groups: [], members: [], focus: [], allows: [] }

export class GroupStore {
  private snapshot = EMPTY_SNAPSHOT
  private selected = GENERAL_GROUP_ID
  private revision = 0
  private hidden: string[] = []
  private pending = false
  private empty = false
  private readonly listeners = new Set<() => void>()
  readonly sessions: ListSource<SessionSnapshot>
  readonly workspaces: ListSource<WorkspaceSnapshot>
  constructor(sessions: ListSource<SessionSnapshot>, workspaces: ListSource<WorkspaceSnapshot>) { this.sessions = sessions; this.workspaces = workspaces }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = (): GroupSnapshot => this.snapshot
  getRevision = (): number => this.revision
  selectedId = (): string => this.selected
  hiddenPages = (): string[] => this.hidden
  isEmpty = (): boolean => this.empty
  isPending = (): boolean => this.pending
  ready = (): boolean => this.snapshot.groups.length > 0 && this.sessions.getSnapshot().phase !== 'pending' && this.workspaces.getSnapshot().phase !== 'pending' && this.workspaces.getSnapshot().state !== 'loading'
  groupOf(id: string): string | undefined { return groupForSession(id, this.workspaces.getSnapshot().items, this.snapshot.members) }
  mainId(): string | undefined { return Object.values(this.sessions.getSnapshot().byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id }
  replace(snapshot: GroupSnapshot): void { this.snapshot = snapshot; this.recompute() }
  select(groupId: string): void { this.selected = groupId; this.recompute() }
  begin(groupId: string): void { this.pending = true; this.empty = false; this.selected = groupId; this.recompute() }
  finish(empty = false): void { this.pending = false; this.empty = empty; this.recompute() }
  watch(): () => void {
    const stop = [this.sessions.subscribe(() => this.recompute()), this.workspaces.subscribe(() => this.recompute())]
    this.recompute()
    return () => { for (const dispose of stop) dispose() }
  }
  private recompute(): void {
    const group = this.ready() ? sessionWorkspaceGroup(this.sessions.getSnapshot(), this.workspaces.getSnapshot().items, this.snapshot.members) : undefined
    if (!this.pending && !this.empty && group !== undefined && this.snapshot.groups.some(g => g.id === group)) this.selected = group
    const next = pagesHidden(this.snapshot.allows, this.empty ? this.selected : group ?? this.selected, new Set(this.snapshot.groups.map(g => g.id)))
    if (next.length !== this.hidden.length || next.some((p, i) => p !== this.hidden[i])) this.hidden = next
    this.revision++
    for (const listener of this.listeners) listener()
  }
  currentFocus(): Focus | undefined {
    if (!this.ready() || this.pending || this.empty) return undefined
    const id = this.mainId()
    if (id === undefined || this.workspaces.getSnapshot().archivedSessionIds.includes(id)) return undefined
    const groupId = this.groupOf(id)
    if (groupId === undefined) return undefined
    return { groupId, workspaceId: this.workspaces.getSnapshot().items.find(w => w.sessionIds.includes(id))?.workspaceId ?? null, sessionId: id }
  }
}
