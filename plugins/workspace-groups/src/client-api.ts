import type { ConflictOwner, GroupSnapshot, ListSource, SessionSnapshot, Workspace, WorkspaceSnapshot } from './contract.ts'
import { GroupStore } from './store.ts'
import { NavigationEpoch, restoration } from './navigation.ts'
import { groupCopy, localizedGroupLabel } from './copy.ts'
import { GENERAL_GROUP_ID, UNASSIGNED_GROUP_ID } from './rules.ts'

export interface ClientContext {
  sessions: { list: ListSource<SessionSnapshot>; refresh(): Promise<void> }
  workspaces: {
    list: ListSource<WorkspaceSnapshot>
    insertBefore(workspaceId: string, beforeId?: string): Promise<unknown>
  }
  uiWorkspace: {
    openWorkspace(id: string): Promise<void>
    openSession(id: string): void
    startSession(id?: string): void
    pinSession(id: string): Promise<void>
    unpinSession(id: string): Promise<void>
    archiveSession(id: string, options?: { stopActivity?: boolean }): Promise<void>
    unarchiveSession(id: string): Promise<void>
    forkSession(id: string): Promise<string>
    listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
    createDirectory(path: string, name: string): Promise<string>
  }
  layout: { selectPanel(id: string | null): void }
  locale: ListSource<{ active: string }>
}
export interface DirectoryListing {
  path: string
  parent?: string | null
  home: string
  entries: { name: string; path: string; hidden: boolean }[]
  crumbs: { name: string; path: string }[]
}
export class RequestFailure extends Error {
  readonly code: string
  readonly owner?: ConflictOwner
  constructor(message: string, code: string, owner?: ConflictOwner) { super(message); this.code = code; this.owner = owner }
}

export const EMPTY_PANEL = 'workspace-groups-empty'
const ROOT = '/console-api/workspace-groups'
export async function request<T>(action: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(ROOT + action, { credentials: 'include', signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  const value = await response.json()
  if (!response.ok) throw new RequestFailure(value.detail ?? '没有完成', value.code ?? 'request/failed', value.owner)
  return value as T
}

export class GroupClient {
  readonly store: GroupStore
  private readonly epochs = new NavigationEpoch()
  private navigation: AbortController | undefined
  private lifetime = new AbortController()
  private refreshEpoch = 0
  private focusTail: Promise<void> = Promise.resolve()
  private pendingFocus = new Map<string, ReturnType<GroupStore['currentFocus']>>()
  private signatures = new Map<string, string>()
  private stops: (() => void)[] = []
  private focusScheduled = false
  readonly ctx: ClientContext
  constructor(ctx: ClientContext) { this.ctx = ctx; this.store = new GroupStore(ctx.sessions.list, ctx.workspaces.list) }
  subscribe = (listener: () => void) => this.store.subscribe(listener)
  getSnapshot = () => this.store.getSnapshot()
  selectedId = () => this.store.selectedId()
  labelOf = (groupId: string): string => {
    const active = this.ctx.locale.getSnapshot().active
    const group = this.store.getSnapshot().groups.find(item => item.id === groupId)
    if (group !== undefined) return localizedGroupLabel(group, active)
    const copy = groupCopy(active)
    return groupId === GENERAL_GROUP_ID ? copy.general : groupId === UNASSIGNED_GROUP_ID ? copy.unassigned : groupId
  }
  hiddenPages = () => this.store.hiddenPages()
  select = (groupId: string) => { void this.enter(groupId).catch(cause => this.report(cause)) }
  private error = ''
  getError = () => this.error
  report(cause: unknown): void { if (this.lifetime.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return; this.error = cause instanceof Error ? cause.message : String(cause); this.store.select(this.store.selectedId()) }
  async start(): Promise<void> {
    this.stops.push(this.store.watch())
    this.stops.push(this.store.subscribe(() => this.remember()))
    this.stops.push(this.ctx.workspaces.list.subscribe(() => { void this.refresh().catch(cause => this.report(cause)) }))
    await this.refresh()
  }
  async close(): Promise<void> {
    this.lifetime.abort(); this.navigation?.abort()
    for (const stop of this.stops) stop()
    await this.focusTail
  }
  async refresh(): Promise<void> {
    const epoch = ++this.refreshEpoch
    const snapshot = await request<GroupSnapshot>('', undefined, this.lifetime.signal)
    if (snapshot.testResetEpoch !== undefined && localStorage.getItem('smp.workspace.history-epoch') !== snapshot.testResetEpoch) {
      const keys = Object.keys(localStorage).filter(key => key.startsWith('dsh.conversation.') || key.startsWith('dsh.workspace.') || key === 'dsh.sessions.current' || key.startsWith('smp.workspace.view.'))
      for (const key of keys) localStorage.removeItem(key)
      localStorage.setItem('smp.workspace.history-epoch', snapshot.testResetEpoch)
      window.location.reload()
      return
    }
    if (epoch === this.refreshEpoch) this.store.replace(snapshot)
  }
  async enter(groupId: string, workspaceId?: string): Promise<void> {
    if (!this.store.getSnapshot().groups.some(g => g.id === groupId)) throw new Error('工作区组不可用')
    const epoch = this.epochs.begin()
    this.navigation?.abort()
    const controller = new AbortController()
    this.navigation = controller
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    const previous = this.store.selectedId()
    this.store.begin(groupId)
    try {
      await this.refresh()
      signal.throwIfAborted()
      const snapshot = this.store.getSnapshot()
      const workspaces = this.ctx.workspaces.list.getSnapshot()
      const destination = restoration(groupId, workspaces.items, snapshot.members, this.ctx.sessions.list.getSnapshot().byId, workspaces.archivedSessionIds, snapshot.focus.find(f => f.groupId === groupId), workspaceId)
      switch (destination.kind) {
        case 'session':
          this.ctx.uiWorkspace.openSession(destination.sessionId)
          await this.waitSelection(destination.sessionId, groupId, signal)
          break
        case 'workspace':
          await this.ctx.uiWorkspace.openWorkspace(destination.workspaceId)
          signal.throwIfAborted()
          await this.waitSelection(undefined, groupId, signal)
          break
        case 'empty':
          this.ctx.layout.selectPanel(EMPTY_PANEL)
          if (this.epochs.current(epoch)) this.store.finish(true)
          return
      }
      signal.throwIfAborted()
      if (!this.epochs.current(epoch)) return
      this.ctx.layout.selectPanel(null)
      this.store.finish()
    } catch (cause) {
      if (this.epochs.current(epoch)) { this.store.select(previous); this.store.finish() }
      throw cause
    }
  }
  openSession(id: string): void { this.store.finish(); this.ctx.uiWorkspace.openSession(id); this.ctx.layout.selectPanel(null) }
  async addWorkspace(groupId: string, path: string): Promise<Workspace> {
    const result = await request<{ workspaceId: string }>('/workspaces', { groupId, path }, this.lifetime.signal)
    const workspace = await this.waitWorkspace(result.workspaceId)
    await this.refresh()
    this.lifetime.signal.throwIfAborted()
    return workspace
  }
  waitWorkspace(id: string): Promise<Workspace> {
    return new Promise((resolve, reject) => {
      const check = () => { const workspace = this.ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === id); if (workspace !== undefined) { dispose(); resolve(workspace) } }
      const abort = () => { dispose(); reject(this.lifetime.signal.reason) }
      const timeout = window.setTimeout(() => { dispose(); reject(new Error('等待工作区同步超时')) }, 20_000)
      const stop = this.ctx.workspaces.list.subscribe(check)
      const dispose = () => { stop(); clearTimeout(timeout); this.lifetime.signal.removeEventListener('abort', abort) }
      this.lifetime.signal.addEventListener('abort', abort, { once: true })
      if (this.lifetime.signal.aborted) abort(); else check()
    })
  }
  private waitSelection(id: string | undefined, groupId: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => { const main = this.store.mainId(); if (main !== undefined && (id === undefined || id === main) && this.store.groupOf(main) === groupId) { dispose(); resolve() } }
      const abort = () => { dispose(); reject(signal.reason) }
      const timeout = window.setTimeout(() => { dispose(); reject(new Error('打开会话超时')) }, 20_000)
      const stop = this.ctx.sessions.list.subscribe(check)
      const stopWorkspace = this.ctx.workspaces.list.subscribe(check)
      const dispose = () => { stop(); stopWorkspace(); clearTimeout(timeout); signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort(); else check()
    })
  }
  private remember(): void {
    const focus = this.store.currentFocus()
    if (focus === undefined || focus.sessionId === null) return
    const signature = `${focus.workspaceId}:${focus.sessionId}`
    if (this.signatures.get(focus.groupId) === signature) return
    this.signatures.set(focus.groupId, signature)
    this.pendingFocus.set(focus.groupId, focus)
    if (this.focusScheduled) return
    this.focusScheduled = true
    this.focusTail = this.focusTail.then(async () => {
      while (this.pendingFocus.size > 0 && !this.lifetime.signal.aborted) {
        const [groupId, value] = this.pendingFocus.entries().next().value!
        this.pendingFocus.delete(groupId)
        if (value === undefined) continue
        try { await request('/focus', value, this.lifetime.signal) } catch (cause) { if (!this.lifetime.signal.aborted) this.report(cause) }
      }
      this.focusScheduled = false
    })
  }
}
