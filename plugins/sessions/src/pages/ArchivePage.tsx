import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { archiveCopy } from '../copy.ts'
import { clampPage, isPageSize, jumpTarget, pageCount, pageSlice, PAGE_SIZES, sessionMatches, sessionOnDates, sessionStatusMatches, sessionWorkspaceMatches, archiveWorkspaceLabel, workspaceOf, type SessionSearchBy, type SessionStatusFilter } from '../query.ts'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface SessionRow {
  id: string
  title?: string
  displayTitle: string
  cwd?: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  blank: boolean
  updatedAt: number
}

interface SessionListState {
  ids: string[]
  byId: Record<string, SessionRow>
  phase: 'pending' | 'ready'
}

interface SessionList {
  getSnapshot(): SessionListState
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
}

interface WorkspaceList {
  getSnapshot(): {
    archivedSessionIds: readonly string[]
    pinnedSessionIds: readonly string[]
    items: readonly { workspaceId?: string; title: string; path: string; sessionIds: readonly string[] }[]
  }
  subscribe(listener: () => void): () => void
}

interface ArchivePageProps {
  locale: LocaleFace
  sessions: { list: SessionList; refresh(): Promise<void> }
  workspaces: {
    list: WorkspaceList
    unarchiveSession(sessionId: string): Promise<void>
  }
  uiWorkspace: { openSession(sessionId: string): void }
  layout: { selectPanel(id: string | null): void }
  workspaceGroups: {
    labelOf(groupId: string): string
    subscribe(listener: () => void): () => void
    getSnapshot(): { groups: readonly { id: string; label: string }[]; members: readonly { workspaceId: string; groupId: string }[] }
  }
}

const PAGE_STYLE = `
.smp-console .smp-archive-tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.smp-console .smp-archive-tools select { width: 140px; flex: none; }
.smp-console .smp-archive-tools .row { display: flex; gap: 6px; align-items: center; }
.smp-console .smp-archive-tools input[type="text"], .smp-console .smp-archive-tools input:not([type]) { flex: 1; min-width: 180px; }
.smp-console .smp-archive-date { display: flex; align-items: center; gap: 6px; color: var(--smp-muted); }
.smp-console .smp-archive-date input { width: 148px; }
.smp-console .smp-archive-table { width: 100%; border-collapse: collapse; }
.smp-console .smp-archive-table th, .smp-console .smp-archive-table td {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2);
  vertical-align: middle; white-space: nowrap;
}
.smp-console .smp-archive-id {
  display: inline-block; max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;
  font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px;
}
.smp-console .smp-archive-table button.copy { cursor: pointer; }
.smp-console .smp-archive-actions { display: flex; gap: 8px; justify-content: flex-end; white-space: nowrap; }
.smp-console .smp-archive-pager { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-top: 12px; flex-wrap: wrap; }
.smp-console .smp-archive-pager .row { display: flex; gap: 8px; align-items: center; }
.smp-console input.smp-page-jump { width: 64px; flex: none; }
`

export function installArchiveStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-sessions'
  tag.textContent = PAGE_STYLE
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

function groupName(groups: { members: readonly { workspaceId: string; groupId: string }[] }, workspaceId: string | undefined, labelOf: (groupId: string) => string): string {
  const groupId = groups.members.find(row => row.workspaceId === workspaceId)?.groupId ?? 'general'
  return labelOf(groupId)
}

function readPendingArchiveSearch(): { by: 'title' | 'id'; query: string } | undefined {
  if (typeof window === 'undefined') return undefined
  const raw = window.sessionStorage.getItem('smp.archive.search')
  if (raw === null) return undefined
  try {
    const value = JSON.parse(raw) as { by?: unknown; query?: unknown }
    return typeof value.query === 'string'
      ? { by: value.by === 'id' ? 'id' : 'title', query: value.query }
      : undefined
  } catch {
    return undefined
  }
}

export function ArchivePage(props: ArchivePageProps) {
  const active = useSyncExternalStore(
    (listener) => props.locale.subscribe(listener),
    () => props.locale.getSnapshot().active,
  )
  const copy = archiveCopy(active)
  const catalog = useSyncExternalStore(
    (listener) => props.sessions.list.subscribe(listener),
    () => props.sessions.list.getSnapshot(),
  )
  const workspaces = useSyncExternalStore(
    (listener) => props.workspaces.list.subscribe(listener),
    () => props.workspaces.list.getSnapshot(),
  )
  const groups = useSyncExternalStore(
    (listener) => props.workspaceGroups.subscribe(listener),
    () => props.workspaceGroups.getSnapshot(),
  )
  const pendingSearch = readPendingArchiveSearch()
  const [by, setBy] = useState<SessionSearchBy>(pendingSearch?.by === 'id' ? 'id' : 'title')
  const [query, setQuery] = useState(pendingSearch?.query ?? '')
  const [status, setStatus] = useState<SessionStatusFilter>('all')
  const [workspacePath, setWorkspacePath] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  useEffect(() => { window.sessionStorage.removeItem('smp.archive.search') }, [])
  const [pageIndex, setPageIndex] = useState(1)
  const [jumpText, setJumpText] = useState('1')
  const [copied, setCopied] = useState('')
  const copiedTimer = useRef(0)
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void props.sessions.refresh()
  }, [props.sessions])

  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])

  const archived = new Set(workspaces.archivedSessionIds)
  const pinned = new Set(workspaces.pinnedSessionIds)
  const narrowed = query.trim() !== '' || status !== 'all' || workspacePath !== '' || from !== '' || to !== ''
  const workspaceOptions = workspaces.items.filter((item, index, all) => all.findIndex(other => other.path === item.path) === index)
  const rows = catalog.ids.flatMap((id) => {
    const row = catalog.byId[id]
    if (row === undefined || row.origin === 'subagent') return []
    const title = row.displayTitle
    const isArchived = archived.has(row.id)
    const account = workspaceOf(row.id, row.cwd, workspaces.items)
    const path = account?.path ?? ''
    if (!sessionMatches({ id: row.id, title }, by, query)) return []
    if (!sessionStatusMatches(isArchived, status)) return []
    if (!sessionWorkspaceMatches(path, workspacePath)) return []
    if (!sessionOnDates(row.updatedAt, from, to)) return []
    const parent = row.parentId === undefined ? undefined : catalog.byId[row.parentId]
    return [{
      ...row,
      title,
      archived: isArchived,
      pinned: pinned.has(row.id),
      workspace: account === undefined ? '' : archiveWorkspaceLabel(groupName(groups, account.workspaceId, props.workspaceGroups.labelOf), account.title, copy.defaultWorkspace),
      parentTitle: parent?.displayTitle ?? row.parentId ?? '',
    }]
  })
  const page = clampPage(pageIndex, rows.length, pageSize)
  const visible = pageSlice(rows, page, pageSize)
  const pages = pageCount(rows.length, pageSize)

  function goTo(raw: string): void {
    const target = jumpTarget(raw, rows.length, pageSize)
    if (target === undefined) return
    setPageIndex(target)
    setJumpText(String(target))
  }

  function markCopied(id: string): void {
    setError('')
    setCopied(id)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(current => current === id ? '' : current), 1500)
  }

  function copySessionId(id: string): void {
    const pending = navigator.clipboard?.writeText(id)
    if (copyWithCommand(id)) {
      void pending?.catch(() => undefined)
      markCopied(id)
      return
    }
    if (pending === undefined) {
      setError(copy.copyFailed)
      return
    }
    void pending.then(() => markCopied(id)).catch(() => setError(copy.copyFailed))
  }

  function open(id: string): void {
    props.uiWorkspace.openSession(id)
    props.layout.selectPanel(null)
  }

  function restore(id: string): void {
    setError('')
    setMessage('')
    setBusy(id)
    void props.workspaces.unarchiveSession(id).then(() => {
      setPending('')
    }).catch((cause: unknown) => {
      setError(cause instanceof Error && cause.message !== '' ? cause.message : copy.restoreFailed)
    }).finally(() => {
      setBusy('')
    })
  }

  function remove(id: string): void {
    setError('')
    setMessage('')
    setBusy(id)
    void fetch('/console-api/sessions/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { detail?: unknown }
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.removeFailed)
      setPending('')
      setMessage(copy.removed)
      await props.sessions.refresh()
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : copy.removeFailed)
    }).finally(() => {
      setBusy('')
    })
  }

  return (
    <>
      {error !== '' && <p className="banner error">{error}</p>}
      {message !== '' && <p className="banner ok">{message}</p>}
      <Panel title={copy.title}>
        <div className="smp-archive-tools">
          <select aria-label={copy.searchBy} value={by} onChange={(event) => { setBy(event.target.value === 'id' ? 'id' : 'title'); setPageIndex(1) }}>
            <option value="title">{copy.byTitle}</option>
            <option value="id">{copy.byId}</option>
          </select>
          <input aria-label={copy.search} value={query} onChange={(event) => { setQuery(event.target.value); setPageIndex(1) }} />
          <label className="smp-archive-date">{copy.from}<input type="date" aria-label={copy.from} value={from} onChange={(event) => { setFrom(event.target.value); setPageIndex(1) }} /></label>
          <label className="smp-archive-date">{copy.to}<input type="date" aria-label={copy.to} value={to} onChange={(event) => { setTo(event.target.value); setPageIndex(1) }} /></label>
          <select aria-label={copy.workspace} value={workspacePath} onChange={(event) => { setWorkspacePath(event.target.value); setPageIndex(1) }}>
            <option value="">{copy.anyWorkspace}</option>
            {workspaceOptions.map(item => (
              <option key={item.path} value={item.path}>{archiveWorkspaceLabel(groupName(groups, item.workspaceId, props.workspaceGroups.labelOf), item.title, copy.defaultWorkspace)}</option>
            ))}
          </select>
          <select aria-label={copy.status} value={status} onChange={(event) => { setStatus(event.target.value === 'active' || event.target.value === 'archived' ? event.target.value : 'all'); setPageIndex(1) }}>
            <option value="all">{copy.anyStatus}</option>
            <option value="active">{copy.active}</option>
            <option value="archived">{copy.archived}</option>
          </select>
          <label className="row">{copy.pageSize}
            <select aria-label={copy.pageSize} value={pageSize} onChange={(event) => {
              const next = Number(event.target.value)
              if (!isPageSize(next)) return
              setPageSize(next)
              setPageIndex(1)
            }}>
              {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
        {catalog.phase === 'pending' && rows.length === 0 ? <p className="muted">{copy.loading}</p> : rows.length === 0 ? (
          <p className="empty">{narrowed ? copy.none : copy.empty}</p>
        ) : (
          <table className="smp-archive-table smp-table">
            <thead>
              <tr>
                <th>{copy.byId}</th>
                <th>{copy.name}</th>
                <th>{copy.workspace}</th>
                <th>{copy.forked}</th>
                <th>{copy.updated}</th>
                <th>{copy.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="copy-line">
                      <span className="smp-archive-id" title={row.id}>{row.id}</span>
                      <button className="copy" type="button" aria-label={copied === row.id ? copy.copied : copy.copyId} title={copied === row.id ? copy.copied : copy.copyId} onClick={() => copySessionId(row.id)}>
                        {copied === row.id ? <CheckIcon /> : <CopyIcon />}
                      </button>
                    </span>
                  </td>
                  <td>{row.title}</td>
                  <td>{row.workspace}</td>
                  <td>{row.parentTitle}</td>
                  <td>{row.updatedAt > 0 ? new Date(row.updatedAt).toLocaleString(active === 'zh' ? 'zh-CN' : 'en') : ''}</td>
                  <td>{[row.archived ? copy.archived : copy.active, row.running ? copy.running : copy.idle, row.blank ? copy.blank : '', row.pinned ? copy.pinned : ''].filter(part => part !== '').join(' · ')}</td>
                  <td>
                    <span className="smp-archive-actions">
                      {row.archived ? (
                        <button className="secondary" type="button" disabled={busy === row.id} onClick={() => restore(row.id)}>{copy.restore}</button>
                      ) : (
                        <button className="secondary" type="button" onClick={() => open(row.id)}>{copy.open}</button>
                      )}
                      {row.archived && pending !== row.id && (
                        <button className="link danger" type="button" disabled={busy === row.id} onClick={() => { setPending(row.id); setError(''); setMessage('') }}>{copy.remove}</button>
                      )}
                      {row.archived && pending === row.id && (
                        <>
                          <button className="link danger" type="button" disabled={busy === row.id} onClick={() => remove(row.id)}>{copy.confirm}</button>
                          <button className="link" type="button" disabled={busy === row.id} onClick={() => setPending('')}>{copy.cancel}</button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          <div className="smp-archive-pager">
            <span className="muted">{fill(copy.total, { count: rows.length })}</span>
            <span className="row">
              <button className="secondary" type="button" disabled={page <= 1} onClick={() => setPageIndex(page - 1)}>{copy.prev}</button>
              <span>{fill(copy.pageOf, { page, pages })}</span>
              <button className="secondary" type="button" disabled={page >= pages} onClick={() => setPageIndex(page + 1)}>{copy.next}</button>
              <input
                className="smp-page-jump"
                aria-label={copy.jumpTo}
                inputMode="numeric"
                value={jumpText}
                onChange={(event) => setJumpText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  goTo(jumpText)
                }}
              />
              <button className="secondary" type="button" onClick={() => goTo(jumpText)}>{copy.jump}</button>
            </span>
          </div>
        )}
      </Panel>
    </>
  )
}

function fill(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.2" y="5.2" width="7.2" height="7.2" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.6 10.2V3.6h6.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.2 6.4 11 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function copyWithCommand(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.focus()
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}
