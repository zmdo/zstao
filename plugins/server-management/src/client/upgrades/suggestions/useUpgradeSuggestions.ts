import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Inventory, Suggestion, Suggestions } from '../../../shared/dto/upgrades.ts'
import { displayError, localized, serverCopy } from '../../../shared/i18n.ts'
import { api, requestError } from '../../shared/api.ts'
import type { ServerPageState } from '../../shared/server-page-state.ts'

export function useUpgradeSuggestions(props: {
  active: string
  pageState: ServerPageState
  enabled: boolean
}) {
  const active = props.active,
    c = serverCopy(active).upgrades
  const snapshot = useSyncExternalStore(props.pageState.subscribe, props.pageState.getSnapshot)
  const context = snapshot.upgradeContext
  const { page } = snapshot.upgradeView
  const setPage = (page: number) => props.pageState.setUpgradePage(page)
  const setPlan = (planId: string) => props.pageState.showUpgradePlan(planId)
  const [q, setQ] = useState(''),
    [decision, setDecision] = useState('pending')
  const [group, setGroup] = useState(context?.groupId ?? ''),
    [type, setType] = useState(''),
    [software, setSoftware] = useState(''),
    [connection, setConnection] = useState(''),
    [current, setCurrent] = useState(''),
    [target, setTarget] = useState('')
  const [data, setData] = useState<Suggestions>(),
    [inventory, setInventory] = useState<Inventory[]>([])
  const [groups, setGroups] = useState<
      { id: string; name: string; name_i18n?: { zh: string; en: string } }[]
    >([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0)
  const [batchSoftware, setBatchSoftware] = useState<string[]>([]),
    [versions, setVersions] = useState<Record<string, string[]>>({}),
    [chosen, setChosen] = useState<Record<string, string>>({}),
    [defer, setDefer] = useState(''),
    [remindAt, setRemindAt] = useState('')
  const params = new URLSearchParams({
    q,
    decision,
    page: String(page),
    group_id: group,
    type_key: type,
    software,
    connection,
    current,
    target,
    ...(context?.serverId ? { server_id: context.serverId } : {}),
  }).toString()
  useEffect(() => {
    if (!props.enabled) return
    let stopped = false
    const load = async () => {
      try {
        const [inventory, groups] = await Promise.all([
          api<Inventory[]>('/console-api/server-changes/inventory'),
          api<{ id: string; name: string; name_i18n?: { zh: string; en: string } }[]>(
            '/console-api/server-groups',
          ),
        ])
        if (stopped) return
        setInventory(inventory)
        setGroups(groups)
        const r = await api<Suggestions>('/console-api/server-changes/suggestions?' + params)
        if (!stopped) setData(r)
      } catch (cause) {
        if (!stopped) setError(displayError(active, requestError(cause)))
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [props.enabled, params, page, tick, active])
  useEffect(() => {
    let stopped = false
    setVersions({})
    setChosen({})
    if (selected.length && batchSoftware.length)
      void Promise.all(
        batchSoftware.map(
          async (software) =>
            [
              software,
              await api<{ versions: string[] }>('/console-api/server-changes/versions', {
                method: 'POST',
                body: JSON.stringify({ server_ids: selected, software }),
              }),
            ] as const,
        ),
      )
        .then((results) => {
          if (stopped) return
          setVersions(Object.fromEntries(results.map(([key, v]) => [key, v.versions])))
          setChosen(Object.fromEntries(results.map(([key, v]) => [key, v.versions[0] ?? ''])))
        })
        .catch((cause) => {
          if (!stopped) setError(displayError(active, requestError(cause)))
        })
    return () => {
      stopped = true
    }
  }, [selected, batchSoftware, active])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setTick((t) => t + 1)
    } catch (cause) {
      setError(displayError(active, requestError(cause)))
    } finally {
      setBusy(false)
    }
  }
  const shown = data?.items ?? [],
    keys = [...new Set(shown.map((s) => s.software_key))],
    filteredServers = inventory.filter(
      (s) =>
        (!group || s.group_id === group) &&
        (!type || s.type_key === type) &&
        (!context?.serverId || s.id === context.serverId),
    )
  const softwareName = (key: string) => {
    const item = inventory.flatMap((s) => s.required_software ?? []).find((s) => s.software_key === key)
    return item ? localized(item.name_i18n, active) : key
  }
  const pick = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]))
  const showAll = () => props.pageState.update({ upgradeContext: undefined })
  const commands = {
    detect: () =>
      run(async () => {
        await api('/console-api/server-changes/detect', {
          method: 'POST',
          body: JSON.stringify({
            server_ids: selected.length ? selected : filteredServers.map((server) => server.id),
          }),
        })
        setNotice(c.detectQueued)
      }),
    changeDecision: (suggestion: Pick<Suggestion, 'id' | 'decision'>) =>
      run(async () => {
        await api(
          `/console-api/server-changes/suggestions/${suggestion.id}/${suggestion.decision === 'rejected' ? 'restore' : 'reject'}`,
          { method: 'POST', body: '{}' },
        )
      }),
    createPlan: () =>
      run(async () => {
        const result = await api<{ id: string }>('/console-api/server-changes/plans', {
          method: 'POST',
          body: JSON.stringify({
            kind: 'upgrade',
            server_ids: selected,
            versions: Object.fromEntries(batchSoftware.map((key) => [key, chosen[key]])),
          }),
        })
        setPlan(result.id)
      }),
    defer: () =>
      run(async () => {
        await api(`/console-api/server-changes/suggestions/${defer}/defer`, {
          method: 'POST',
          body: JSON.stringify({ until: new Date(remindAt).toISOString() }),
        })
        setDefer('')
      }),
    remindNow: () =>
      run(async () => {
        await api(`/console-api/server-changes/suggestions/${defer}/defer`, {
          method: 'POST',
          body: '{"until":null}',
        })
        setDefer('')
      }),
  }

  return {
    active,
    batchSoftware,
    busy,
    c,
    chosen,
    commands,
    connection,
    context,
    current,
    data,
    decision,
    defer,
    error,
    filteredServers,
    group,
    groups,
    inventory,
    keys,
    notice,
    page,
    pick,
    q,
    remindAt,
    selected,
    setBatchSoftware,
    setChosen,
    setConnection,
    setCurrent,
    setDecision,
    setDefer,
    setGroup,
    setPage,
    setQ,
    setRemindAt,
    setSelected,
    setSoftware,
    setTarget,
    setType,
    showAll,
    shown,
    software,
    softwareName,
    target,
    type,
    versions,
  }
}
export type UpgradeSuggestionsModel = ReturnType<typeof useUpgradeSuggestions>
