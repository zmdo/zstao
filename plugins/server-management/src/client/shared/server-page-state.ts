export interface ServerListView {
  groupId: string | null
  query: string
  page: number
  pageSize: number
  status: string
  needsUpgrade?: boolean
  order: 'name' | 'last_checked'
}

/** Panels inside one server's detail workspace. The local sidebar stays visible for all of them. */
export type DetailPanel = 'detail' | 'tasks' | 'terminal' | 'config' | `extension:${string}`

export interface TaskViewState {
  query: string
  action: string
  status: string
  from: string
  to: string
  page: number
  pageSize: number
}

export const DEFAULT_TASK_PAGE_SIZE = 20

export function emptyTaskView(pageSize = DEFAULT_TASK_PAGE_SIZE): TaskViewState {
  return { query: '', action: '', status: '', from: '', to: '', page: 1, pageSize }
}

export interface ServerPageSnapshot {
  screen: 'list' | 'form' | 'detail'
  serverId: string
  editing: boolean
  detailPanel: DetailPanel
  listView: ServerListView
  taskViews: Record<string, TaskViewState>
  upgradeContext?: { serverId?: string; groupId?: string }
  upgradeView: {
    tab: 'suggestions' | 'plans' | 'records'
    page: number
    planId: string
  }
}

/** Owned by one client plugin instance, so settings navigation does not erase the server page. */
export function createServerPageState() {
  let snapshot: ServerPageSnapshot = {
    screen: 'list',
    serverId: '',
    editing: false,
    detailPanel: 'detail',
    listView: { groupId: null, query: '', page: 1, pageSize: 10, status: '', order: 'name' },
    taskViews: {},
    upgradeView: { tab: 'suggestions', page: 1, planId: '' },
  }
  const listeners = new Set<() => void>()
  const update = (values: Partial<ServerPageSnapshot>) => {
    snapshot = { ...snapshot, ...values }
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update,
    /** A server switch starts at the base detail panel; its task filters remain under taskView(). */
    openServer(serverId: string) {
      update({ screen: 'detail', serverId, editing: false, detailPanel: 'detail' })
    },
    closeWorkspace() {
      update({ screen: 'list', serverId: '', editing: false, detailPanel: 'detail' })
    },
    selectDetailPanel(detailPanel: DetailPanel) {
      update({ detailPanel })
    },
    taskView(serverId: string): TaskViewState {
      return snapshot.taskViews[serverId] ?? emptyTaskView()
    },
    setTaskView(serverId: string, view: TaskViewState) {
      update({ taskViews: { ...snapshot.taskViews, [serverId]: view } })
    },
    selectUpgradeTab(tab: ServerPageSnapshot['upgradeView']['tab']) {
      update({ upgradeView: { tab, page: 1, planId: '' } })
    },
    setUpgradePage(page: number) {
      update({ upgradeView: { ...snapshot.upgradeView, page } })
    },
    showUpgradePlan(planId: string) {
      update({ upgradeView: { tab: 'plans', page: 1, planId } })
    },
    dispose() {
      listeners.clear()
    },
  }
}
export type ServerPageState = ReturnType<typeof createServerPageState>
