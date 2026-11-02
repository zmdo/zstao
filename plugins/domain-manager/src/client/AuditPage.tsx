import { useEffect, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { api, type LocaleFace } from './api.ts'
import { copyFor, type Copy } from './copy.ts'

interface AuditItem {
  id: string
  sessionId: string | null
  tool: string
  action: string
  domainName: string
  summary: string
  args: Record<string, unknown>
  ok: boolean
  error: string | null
  createdAt: string
}

interface AuditData {
  items: AuditItem[]
  total: number
  page: number
  pageSize: number
}

function formatTime(iso: string, active: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(active.startsWith('en') ? 'en-US' : 'zh-CN')
}

export function AuditPage(props: { locale: LocaleFace }) {
  const active = useSyncExternalStore(
    (listener) => props.locale.subscribe(listener),
    () => props.locale.getSnapshot().active,
  )
  const copy = copyFor(active)
  const [page, setPage] = useState(1)
  const [tool, setTool] = useState('')
  const [hours, setHours] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [appliedDomain, setAppliedDomain] = useState('')
  const [data, setData] = useState<AuditData | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState('')

  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ page: String(page), page_size: '20', tool, hours })
    if (appliedDomain !== '') query.set('domain', appliedDomain)
    void api<AuditData>(`/console-api/domains/audit?${query.toString()}`)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [page, tool, hours, appliedDomain])

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 20)))

  return (
    <Panel
      className="smp-list-panel smp-domain-audit"
      title={copy.auditTitle}
      extra={
        <div className="row smp-domain-audit-tools">
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(1)
              setAppliedDomain(domainFilter.trim())
            }}
          >
            <input
              type="search"
              className="search"
              aria-label={copy.auditDomainFilter}
              placeholder={copy.auditDomainFilter}
              value={domainFilter}
              maxLength={120}
              onChange={(event) => {
                setDomainFilter(event.target.value)
              }}
            />
            <button className="secondary" type="submit">
              {copy.search}
            </button>
          </form>
          <select
            aria-label={copy.auditTool}
            value={tool}
            onChange={(event) => {
              setTool(event.target.value)
              setPage(1)
            }}
          >
            <option value="">{copy.auditAllTools}</option>
            <option value="create">{copy.auditCreate}</option>
            <option value="update">{copy.auditUpdate}</option>
            <option value="delete">{copy.auditDelete}</option>
          </select>
          <select
            aria-label={copy.auditTimeRange}
            value={hours}
            onChange={(event) => {
              setHours(event.target.value)
              setPage(1)
            }}
          >
            <option value="">{copy.auditAllTime}</option>
            <option value="24">{copy.auditLast24h}</option>
            <option value="168">{copy.auditLast7d}</option>
            <option value="720">{copy.auditLast30d}</option>
          </select>
        </div>
      }
    >
      {error !== '' && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <div className="smp-list-scroll">
        <table className="smp-table smp-domain-audit-table">
          <thead>
            <tr>
              <th>{copy.auditTime}</th>
              <th>{copy.auditAction}</th>
              <th>{copy.auditDomain}</th>
              <th>{copy.auditSummary}</th>
              <th>{copy.auditStatus}</th>
              <th>{copy.auditSession}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr
                key={item.id}
                className={openId === item.id ? 'smp-domain-audit-row is-open' : 'smp-domain-audit-row'}
                role="button"
                aria-expanded={openId === item.id}
                tabIndex={0}
                onClick={() => setOpenId((current) => (current === item.id ? '' : item.id))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setOpenId((current) => (current === item.id ? '' : item.id))
                }}
              >
                <td className="nowrap">{formatTime(item.createdAt, active)}</td>
                <td className="nowrap">{actionLabel(copy, item.action)}</td>
                <td>{item.domainName}</td>
                <td className="smp-domain-audit-summary">{item.summary}</td>
                <td className="nowrap">
                  <span className={`smp-audit-status is-${item.ok ? 'succeeded' : 'failed'}`}>{item.ok ? copy.auditSucceeded : copy.auditFailed}</span>
                </td>
                <td className="smp-domain-audit-session" title={item.sessionId ?? ''}>
                  {item.sessionId === null ? '—' : item.sessionId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.items.length ?? 0) === 0 && (
          <p className="smp-domain-empty">{error !== '' ? copy.auditLoadFailed : copy.auditEmpty}</p>
        )}
        {openId !== '' && (
          <AuditDetail item={(data?.items ?? []).find((row) => row.id === openId)} copy={copy} />
        )}
      </div>
      <footer className="smp-list-pager smp-domain-pager">
        <span>{formatRange(copy, total, page, pages)}</span>
        <div className="row">
          <button className="secondary" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            {copy.previous}
          </button>
          <span aria-live="polite">
            {page} / {pages}
          </span>
          <button className="secondary" type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
            {copy.next}
          </button>
        </div>
      </footer>
    </Panel>
  )
}

function actionLabel(copy: Copy, action: string): string {
  if (action === 'create') return copy.auditCreate
  if (action === 'update') return copy.auditUpdate
  if (action === 'delete') return copy.auditDelete
  return action
}

function formatRange(copy: Copy, total: number, page: number, pages: number): string {
  const from = total === 0 ? 0 : (page - 1) * 20 + 1
  const to = total === 0 ? 0 : Math.min(page * 20, total)
  return `${from}-${to} / ${total}`
}

function AuditDetail(props: { item: AuditItem | undefined; copy: Copy }) {
  if (props.item === undefined) return null
  const item = props.item
  return (
    <div className="smp-domain-audit-detail">
      {item.error !== null && (
        <p className="banner error" role="alert">
          {item.error}
        </p>
      )}
      <dl>
        <dt>{props.copy.auditTool}</dt>
        <dd className="mono">{item.tool}</dd>
        <dt>{props.copy.auditArgs}</dt>
        <dd>
          <pre className="config">{JSON.stringify(item.args, null, 2)}</pre>
        </dd>
      </dl>
    </div>
  )
}
