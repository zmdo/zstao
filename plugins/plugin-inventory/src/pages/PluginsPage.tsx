import { useEffect, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { pluginsCopy } from '../copy.ts'
import { clampPage, globalRows, isPageSize, isStatusFilter, pageCount, PAGE_SIZES, pageSlice, rowsByStatus, STATUS_FILTERS, type InventoryEntry, type PluginRow, type PluginStatus, type PresetGroup, type StatusFilter } from '../rows.ts'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface RemoteResult<T> {
  ok: boolean
  value?: T
  error?: { message?: string }
}

interface InventorySnapshot {
  entries: readonly InventoryEntry[]
  agentPresets?: readonly PresetGroup[]
}

interface RemoteInventory {
  list(): Promise<RemoteResult<InventorySnapshot>>
}

const PILL: Record<PluginStatus, string> = {
  enabled: 'succeeded',
  disabled: 'offline',
  failed: 'failed',
  preset: 'queued',
  pending: 'queued',
  loading: 'queued',
  unloading: 'queued',
}

const PAGE_STYLE = `
.smp-plugins-pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.smp-plugins-pager .row { gap: 8px; }
.smp-plugins-head-extra { gap: 8px; align-items: center; }
.smp-console select.smp-page-size, .smp-console select.smp-status-filter { width: auto; }
.smp-console table.smp-plugins tbody tr.smp-plugin-row { cursor: pointer; }
.smp-console table.smp-plugins tbody tr.smp-plugin-row:hover td, .smp-console table.smp-plugins tbody tr.is-open td { background: #f7f9fc; }
.smp-console .smp-plugin-detail { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px 16px; margin: 0; }
.smp-console .smp-plugin-detail dt { color: var(--muted); }
.smp-console .smp-plugin-detail dd { margin: 0; }
.smp-console .smp-plugin-detail img { width: 24px; height: 24px; }
`

export function installPluginsStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-plugin-inventory'
  tag.textContent = PAGE_STYLE
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

function messageOf(error: { message?: string } | undefined, fallback: string): string {
  return error?.message !== undefined && error.message !== '' ? error.message : fallback
}

function fill(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''))
}

function phaseText(phase: PluginRow['fiberPhase'], copy: ReturnType<typeof pluginsCopy>): string {
  if (phase === null) return copy.phases.none
  switch (phase) {
    case 'pending': return copy.phases.pending
    case 'loading': return copy.phases.loading
    case 'active': return copy.phases.active
    case 'failed': return copy.phases.failed
    case 'unloading': return copy.phases.unloading
    default: return assertNever(phase)
  }
}

function assertNever(value: never): never {
  throw new Error(String(value))
}

export function PluginsPage(props: { locale: LocaleFace; inventory: RemoteInventory }) {
  const locale = useSyncExternalStore(listener => props.locale.subscribe(listener), () => props.locale.getSnapshot())
  const copy = pluginsCopy(locale.active)
  const [entries, setEntries] = useState<readonly InventoryEntry[]>([])
  const [presets, setPresets] = useState<readonly PresetGroup[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [pageSize, setPageSize] = useState<number>(20)
  const [pageIndex, setPageIndex] = useState(1)
  const [openId, setOpenId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stopped = false
    setLoading(true)
    void props.inventory.list().then(response => {
      if (stopped) return
      setLoading(false)
      if (!response.ok || response.value === undefined) {
        setError(messageOf(response.error, copy.loadFailed))
        return
      }
      setEntries(response.value.entries)
      setPresets(response.value.agentPresets ?? [])
      setError('')
    }).catch((cause: unknown) => {
      if (stopped) return
      setLoading(false)
      setError(cause instanceof Error ? cause.message : copy.loadFailed)
    })
    return () => { stopped = true }
  }, [props.inventory, copy.loadFailed, reloadKey])

  const rows = rowsByStatus(globalRows(entries, presets, locale.active, query), status)
  const page = clampPage(pageIndex, rows.length, pageSize)
  const visible = pageSlice(rows, page, pageSize)
  const pages = pageCount(rows.length, pageSize)
  const narrowed = query.trim() !== '' || status !== 'all'

  return (
    <Panel
      className="smp-list-panel"
      title={copy.title}
      extra={
        <div className="row smp-plugins-head-extra">
          <select
            className="smp-status-filter"
            aria-label={copy.status}
            value={status}
            onChange={event => {
              if (!isStatusFilter(event.target.value)) return
              setStatus(event.target.value)
              setPageIndex(1)
              setOpenId('')
            }}
          >
            {STATUS_FILTERS.map(value => (
              <option key={value} value={value}>{value === 'all' ? copy.all : statusLabel(value, copy)}</option>
            ))}
          </select>
          <input
            className="search"
            type="search"
            aria-label={copy.search}
            placeholder={copy.search}
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setPageIndex(1)
              setOpenId('')
            }}
          />
        </div>
      }
    >
      {error !== '' && <p className="banner error">{error}</p>}
      {loading ? <p className="muted">{copy.loading}</p>
        : rows.length === 0 ? <p className="empty">{narrowed ? copy.noMatch : copy.empty}</p>
          : (
            <div className="table-wrap smp-list-scroll">
              <table className="smp-plugins smp-table">
                <thead>
                  <tr>
                    <th>{copy.name}</th>
                    <th>{copy.summary}</th>
                    <th>{copy.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(row => (
                    <PluginLine
                      key={row.id}
                      row={row}
                      copy={copy}
                      expanded={openId === row.id}
                      onToggle={() => setOpenId(current => current === row.id ? '' : row.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
      {rows.length > 0 && (
        <div className="smp-plugins-pager smp-list-pager">
          <span className="muted">{fill(copy.total, { count: rows.length })}</span>
          <div className="row">
            <label>
              {copy.pageSize}
              <select
                className="smp-page-size"
                aria-label={copy.pageSize}
                value={pageSize}
                onChange={event => {
                  const next = Number(event.target.value)
                  if (!isPageSize(next)) return
                  setPageSize(next)
                  setPageIndex(1)
                  setOpenId('')
                }}
              >
                {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button className="secondary" type="button" disabled={page <= 1} onClick={() => { setPageIndex(page - 1); setOpenId('') }}>{copy.prev}</button>
            <span>{fill(copy.pageOf, { page, pages })}</span>
            <button className="secondary" type="button" disabled={page >= pages} onClick={() => { setPageIndex(page + 1); setOpenId('') }}>{copy.next}</button>
          </div>
        </div>
      )}
      {error !== '' && <p><button className="secondary" type="button" onClick={() => setReloadKey(current => current + 1)}>{copy.retry}</button></p>}
    </Panel>
  )
}

function statusLabel(status: PluginStatus, copy: ReturnType<typeof pluginsCopy>): string {
  return copy[status === 'loading' ? 'loadingPhase' : status]
}

function PluginLine(props: { row: PluginRow; copy: ReturnType<typeof pluginsCopy>; expanded: boolean; onToggle(): void }) {
  const { row, copy } = props
  const label = statusLabel(row.status, copy)
  const detail = row.status === 'preset' && row.enabledIn.length > 0 ? `${label} · ${row.enabledIn.join(' · ')}` : label
  return (
    <>
      <tr
        className={props.expanded ? 'smp-plugin-row is-open' : 'smp-plugin-row'}
        role="button"
        aria-label={row.title}
        aria-expanded={props.expanded}
        tabIndex={0}
        onClick={props.onToggle}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.onToggle()
        }}
      >
        <td>{row.title}</td>
        <td>{row.description}</td>
        <td><span className={`pill ${PILL[row.status]}`}>{detail}</span></td>
      </tr>
      {props.expanded && (
        <tr>
          <td className="detail" colSpan={3}>
            <dl className="smp-plugin-detail">
              {row.icon !== '' && (<><dt>{copy.icon}</dt><dd><img src={row.icon} alt="" /></dd></>)}
              <dt>{copy.module}</dt>
              <dd className="mono">{row.moduleName}</dd>
              <dt>{copy.entry}</dt>
              <dd className="mono">{row.id}</dd>
              <dt>{copy.enabledFlag}</dt>
              <dd>{row.enabled ? copy.yes : copy.no}</dd>
              <dt>{copy.phase}</dt>
              <dd>{phaseText(row.fiberPhase, copy)}</dd>
              <dt>{copy.presets}</dt>
              <dd>{row.enabledIn.length === 0 ? copy.none : row.enabledIn.join('、')}</dd>
              {row.metaError !== '' && (<><dt>{copy.metaError}</dt><dd>{row.metaError}</dd></>)}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
