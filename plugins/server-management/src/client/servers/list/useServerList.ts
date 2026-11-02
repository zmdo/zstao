import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { GroupDto } from '../../../shared/dto/groups.ts'
import { ServerError } from '../../../shared/errors.ts'
import { groupName as localizedGroupName, serverCopy } from '../../../shared/i18n.ts'
import { type ServerGroupSummary, type ServerListPage } from '../../../shared/dto/servers.ts'
import type { TaskDto } from '../../../shared/dto/tasks.ts'
import { api, requestError } from '../../shared/api.ts'
import type { ServerListView as ListView } from '../../shared/server-page-state.ts'
export interface ServerListProps {
  active: string
  view: ListView
  onView: (view: ListView) => void
  onOpen: (id: string) => void
  onTerminal: (id: string) => void
  onCreate: () => void
  onUpgrades: () => void
}

export function useServerList(props: ServerListProps) {
  const { active } = props
  const copy = serverCopy(active).ui
  const { view, onView } = props
  const [result, setResult] = useState<{ key: string; data: ServerListPage }>()
  const [groups, setGroups] = useState<ServerGroupSummary[]>([])
  const [counts, setCounts] = useState({ all: 0, ungrouped: 0 })
  const [loadError, setLoadError] = useState<ServerError | null>(null)
  const [actionError, setActionError] = useState<ServerError | null>(null)
  const [groupError, setGroupError] = useState<ServerError | null>(null)
  const [groupName, setGroupName] = useState('')
  const [addingGroup, setAddingGroup] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const dataVersion = useRef(0)
  const tableScroll = useRef<HTMLDivElement>(null)
  const params = new URLSearchParams({
    q: view.query,
    status: view.status,
    order: view.order,
    page: String(view.page),
    page_size: String(view.pageSize),
  })
  if (view.needsUpgrade) params.set('needs_upgrade', 'true')
  if (view.groupId !== null) params.set('group_id', view.groupId || 'ungrouped')
  const key = params.toString()
  const latestKey = useRef(key)
  latestKey.current = key
  const data = result?.key === key ? result.data : undefined
  const loaded = data !== undefined
  const groupId = view.groupId
  const selectedGroup = groups.find((group) => group.id === groupId)
  const groupLabel =
    groupId === null
      ? copy.allServers
      : groupId === ''
        ? copy.ungrouped
        : selectedGroup
          ? localizedGroupName(active, selectedGroup)
          : ''
  const total = data?.total ?? 0
  const page = data?.page ?? view.page
  const pages = Math.max(1, Math.ceil(total / view.pageSize))
  const rows = data?.items ?? []

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const version = dataVersion.current
    setLoadError(null)
    async function load() {
      try {
        const next = await api<ServerListPage>(`/console-api/servers?${key}`, { signal: controller.signal })
        if (stopped || version !== dataVersion.current || latestKey.current !== key) return
        setResult({ key, data: next })
        setGroups(next.groups.map((group) => ({ ...group, server_count: group.server_count ?? 0 })))
        setCounts(next.counts)
        setLoadError(null)
        if (next.page !== view.page || next.group_id !== view.groupId)
          onView({ ...view, page: next.page, groupId: next.group_id })
      } catch (cause) {
        if (!stopped && version === dataVersion.current && latestKey.current === key)
          setLoadError(requestError(cause))
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void load()
          }, 1000)
      }
    }
    timer = setTimeout(() => {
      void load()
    }, 150)
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [key, refresh, onView])

  useEffect(() => {
    if (tableScroll.current !== null) tableScroll.current.scrollTop = 0
  }, [key])

  function selectGroup(id: string | null): void {
    onView({ ...view, groupId: id, page: 1 })
    setActionError(null)
  }

  async function createGroup(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (creatingGroup) return
    setCreatingGroup(true)
    setGroupError(null)
    try {
      const group = await api<GroupDto>('/console-api/server-groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName }),
      })
      dataVersion.current += 1
      setRefresh((value) => value + 1)
      setGroups((current) => [...current, group])
      selectGroup(group.id)
      setGroupName('')
      setAddingGroup(false)
    } catch (cause) {
      setGroupError(requestError(cause))
    } finally {
      setCreatingGroup(false)
    }
  }

  async function renameGroup(id: string, name: string): Promise<boolean> {
    setActionError(null)
    try {
      const group = await api<GroupDto>(`/console-api/server-groups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      dataVersion.current += 1
      setRefresh((value) => value + 1)
      setGroups((current) => current.map((item) => (item.id === id ? { ...item, ...group } : item)))
      return true
    } catch (cause) {
      setActionError(requestError(cause))
      return false
    }
  }

  async function retryConnections(): Promise<void> {
    if (refreshing || rows.length === 0) return
    setRefreshing(true)
    setActionError(null)
    const submitted = await Promise.allSettled(
      rows.map((row) => api<TaskDto>(`/console-api/servers/${row.id}/test`, { method: 'POST' })),
    )
    const failed = submitted.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') setActionError(requestError(failed.reason))
    const ids = submitted.flatMap((result) =>
      result.status === 'fulfilled' && result.value.id ? [result.value.id] : [],
    )
    await waitForJobs(ids)
    dataVersion.current += 1
    setRefresh((value) => value + 1)
    setRefreshing(false)
  }

  async function waitForJobs(ids: string[]): Promise<void> {
    const terminal = new Set(['succeeded', 'failed', 'cancelled'])
    let pending = ids
    const deadline = Date.now() + 120_000
    while (pending.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const states = await Promise.allSettled(
        pending.map((id) => api<TaskDto>(`/console-api/server-jobs/${id}`)),
      )
      pending = states.flatMap((result, index) =>
        result.status === 'fulfilled' && !terminal.has(result.value.status) ? [pending[index]!] : [],
      )
    }
  }

  async function removeServer(id: string): Promise<boolean> {
    setActionError(null)
    try {
      await api(`/console-api/servers/${id}`, { method: 'DELETE' })
      dataVersion.current += 1
      setRefresh((value) => value + 1)
      return true
    } catch (cause) {
      setActionError(requestError(cause))
      return false
    }
  }

  async function removeGroup(id: string): Promise<void> {
    setActionError(null)
    try {
      await api(`/console-api/server-groups/${id}`, { method: 'DELETE' })
      dataVersion.current += 1
      setRefresh((value) => value + 1)
      setGroups((current) => current.filter((group) => group.id !== id))
      if (groupId === id) selectGroup('')
    } catch (cause) {
      setActionError(requestError(cause))
    }
  }

  return {
    actionError,
    active,
    addingGroup,
    copy,
    counts,
    createGroup,
    creatingGroup,
    groupError,
    groupId,
    groupLabel,
    groupName,
    groups,
    key,
    loadError,
    loaded,
    onView,
    page,
    pages,
    refreshing,
    removeGroup,
    removeServer,
    retryConnections,
    renameGroup,
    rows,
    selectGroup,
    setAddingGroup,
    setGroupError,
    setGroupName,
    tableScroll,
    total,
    view,
  }
}
export type ServerListModel = ReturnType<typeof useServerList>
