import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { GroupClient, request } from './client-api.ts'
import type { Workspace } from './contract.ts'
import type { Slots, SlotEntry, WorkspaceFace, ViewState } from './bridge.ts'
import { groupCopy } from './copy.ts'
import { UNASSIGNED_GROUP_ID } from './rules.ts'
import { sidebarProjection } from './sidebar-projection.ts'

export type RenderSidebarSlot = (name: string, props: object) => ReactNode

// Keep the existing switch in the native section-label position. No workspace or row styles.
export const SIDEBAR_STYLE = `
.smp-group-switch { position:absolute; z-index:2; top:8px; left:8px; max-width:45%; height:28px; display:flex; align-items:center; }
.smp-group-switch select { width:auto; max-width:100%; margin:0; padding:0 14px 0 0; border:0; background:transparent; color:var(--dsw-alias-label-tertiary, inherit); font:inherit; font-size:13px; line-height:20px; cursor:pointer; }
.smp-chat-side [data-slot="sidebar.workspaces"] [class*="_sectionLabel"] { visibility:hidden; }
.smp-chat-side:has([class*="sectionLabelHidden"]) .smp-group-switch { visibility:hidden; }
`

export function GroupSidebar({ client, slots, renderSlot }: { client: GroupClient; slots: Slots; renderSlot: RenderSidebarSlot }) {
  useSyncExternalStore(client.subscribe, client.store.getRevision)
  const locale = useSyncExternalStore(listener => client.ctx.locale.subscribe(listener), () => client.ctx.locale.getSnapshot())
  const entries = useSyncExternalStore(listener => slots.subscribe('sidebar.workspaces', listener), () => slots.entries('sidebar.workspaces'))
  const entry = entries.find(row => (row.options.priority ?? 0) === 0)
  const binding = useMemo(() => entry === undefined ? undefined : new NativeSidebarBinding(client, entry), [client, entry])
  const copy = groupCopy(locale.active)
  return <>
    <div className="smp-group-switch">
      <select aria-label={copy.group} value={client.selectedId()} title={client.getError() || client.labelOf(client.selectedId())} onChange={event => client.select(event.target.value)}>
        {client.getSnapshot().groups.map(group => <option key={group.id} value={group.id}>{client.labelOf(group.id)}</option>)}
      </select>
    </div>
    {renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {}, ...binding?.props })}
  </>
}

/** Adapt the pinned renderer's owner-prop seam; the official entry still owns its tree and child slots. */
class NativeSidebarBinding {
  readonly props: object
  constructor(client: GroupClient, entry: SlotEntry) {
    const native = entry.inject!() as WorkspaceFace
    // ui-workspace publishes this handle over its one existing view instance (create returns that instance).
    const view = entry.store!.create()
    const initialSearch = native.hooks.workspaceShortcuts.getSnapshot().searchRequest
    let addGroup: string | undefined
    let addRequested = false
    let adopted: string | undefined
    const useProjection = () => {
      useSyncExternalStore(client.subscribe, client.store.getRevision)
      const groups = client.getSnapshot()
      const workspaces = client.ctx.workspaces.list.getSnapshot()
      const sessions = client.ctx.sessions.list.getSnapshot()
      const groupId = client.selectedId()
      return useMemo(() => sidebarProjection(groupId, groups, workspaces, sessions), [groupId, groups, workspaces, sessions])
    }
    this.props = {
      useWorkspaces: <T,>(select: (state: ReturnType<typeof sidebarProjection>['workspaces']) => T) => select(useProjection().workspaces),
      useSessions: <T,>(select: (state: ReturnType<typeof sidebarProjection>['sessions']) => T) => select(useProjection().sessions),
      useStore: <T,>(select: (state: ViewState) => T) => {
        useSyncExternalStore(client.subscribe, client.store.getRevision)
        const state = useSyncExternalStore(listener => view.subscribe(listener), () => view.getSnapshot())
        return select(client.selectedId() === UNASSIGNED_GROUP_ID ? { ...state, groupBy: 'flat' } : state)
      },
      actions: {
        ...view.actions,
        // A projected list must never prune the other groups' native expansion/order accounts.
        retainAccountKeys: () => view.actions.retainAccountKeys(['', '__flat_session_order__', ...client.ctx.workspaces.list.getSnapshot().items.map(w => w.workspaceId)]),
      },
      useDirectoryFlow: <T,>(select: (occupied: boolean) => T) => {
        useSyncExternalStore(client.subscribe, client.store.getRevision)
        const occupied = useSyncExternalStore(listener => native.hooks.directoryFlow.subscribe(listener), () => native.hooks.directoryFlow.getSnapshot())
        return select(occupied && client.selectedId() !== UNASSIGNED_GROUP_ID)
      },
      useWorkspaceShortcuts: <T,>(select: (state: ReturnType<WorkspaceFace['hooks']['workspaceShortcuts']['getSnapshot']>) => T) => {
        useSyncExternalStore(client.subscribe, client.store.getRevision)
        const state = useSyncExternalStore(listener => native.hooks.workspaceShortcuts.subscribe(listener), () => native.hooks.workspaceShortcuts.getSnapshot())
        const system = client.selectedId() === UNASSIGNED_GROUP_ID
        if (state.addRequested && !addRequested) addGroup = client.selectedId()
        addRequested = state.addRequested
        useEffect(() => { if (system && state.addRequested) native.closeAddWorkspace() }, [system, state.addRequested])
        return select({ ...state, searchRequest: Math.max(0, state.searchRequest - initialSearch), addRequested: state.addRequested && !system })
      },
      requestAddWorkspace: () => { addGroup = client.selectedId(); native.requestAddWorkspace() },
      createWorkspace: async (input: { path: string }): Promise<Workspace> => {
        const groupId = addGroup ?? client.selectedId()
        const workspace = await client.addWorkspace(groupId, input.path)
        adopted = workspace.workspaceId
        addGroup = undefined
        return workspace
      },
      startSession: (id?: string, options?: { clearPreviousDraft?: boolean }) => {
        if (id !== undefined && adopted === id) {
          adopted = undefined
          void client.enter(client.getSnapshot().members.find(m => m.workspaceId === id)!.groupId, id).catch(cause => client.report(cause))
        } else native.startSession(id, options)
      },
      renameWorkspace: async (workspaceId: string, title: string) => { await request('/rename', { workspaceId, title }); await client.refresh() },
      deleteWorkspace: async (workspaceId: string) => { await request('/remove', { workspaceId }); await client.refresh() },
      searchSessions: (query: string, signal: AbortSignal) => request('/search', { query, groupId: client.selectedId() }, signal),
    }
  }
}
