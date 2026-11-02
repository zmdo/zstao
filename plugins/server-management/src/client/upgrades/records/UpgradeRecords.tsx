import { Panel } from '@smp/console-kit'
import { Fragment, useState, type ReactNode } from 'react'
import type { RecordPage } from '../../../shared/dto/upgrades.ts'
import { displayError, enumLabel, format, formatDate, serverCopy } from '../../../shared/i18n.ts'
import { usePollingResource } from '../../shared/usePollingResource.ts'

export function UpgradeRecords(props: {
  active: string
  page: number
  onPage: (page: number) => void
  onPlan: (id: string) => void
  back?: ReactNode
}) {
  const { active, page, onPage: setPage, onPlan: setPlan } = props,
    c = serverCopy(active).upgrades,
    ui = serverCopy(active).ui
  const [pageSize, setPageSize] = useState(20)
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [hours, setHours] = useState('')
  const { data: records, error } = usePollingResource<RecordPage>(
    `/console-api/server-changes/records?page=${page}&page_size=${pageSize}&q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}&hours=${hours}`,
  )
  return (
    <Panel
      className="smp-upgrade-page smp-list-panel"
      title={c.records}
      extra={
        <div className="row smp-records-tools">
          <input
            className="search"
            type="search"
            aria-label={c.recordSearch}
            placeholder={c.recordSearch}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
              setOpenId(null)
            }}
          />
          <select
            aria-label={c.status}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
              setOpenId(null)
            }}
          >
            <option value="">{c.recordAllStates}</option>
            {['running', 'succeeded', 'failed', 'cancelled'].map((state) => (
              <option key={state} value={state}>{enumLabel(c, state)}</option>
            ))}
          </select>
          <select
            aria-label={c.recordTime}
            value={hours}
            onChange={(event) => {
              setHours(event.target.value)
              setPage(1)
              setOpenId(null)
            }}
          >
            <option value="">{c.recordAllTime}</option>
            <option value="24">{c.recordLast24h}</option>
            <option value="168">{c.recordLast7d}</option>
            <option value="720">{c.recordLast30d}</option>
          </select>
          {props.back}
        </div>
      }
    >
      {error && (
        <p className="banner error" role="alert">
          {displayError(active, error)}
        </p>
      )}
      <div className="smp-list-scroll">
        <table className="smp-table smp-records-table">
          <thead>
            <tr>
              <th>{c.server}</th>
              <th>{c.status}</th>
              <th>{c.start}</th>
              <th>{c.remoteChanges}</th>
            </tr>
          </thead>
          <tbody>
            {records?.items.map((r) => (
              <Fragment key={r.id}>
                <tr
                  key={r.id}
                  className={openId === r.id ? 'smp-record-row is-open' : 'smp-record-row'}
                  role="button"
                  aria-label={`${r.server_snapshot.name} ${enumLabel(c, r.state)}`}
                  aria-expanded={openId === r.id}
                  tabIndex={0}
                  onClick={() => setOpenId((current) => (current === r.id ? null : r.id))}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    if ((event.target as HTMLElement).closest('button, a, input, select')) return
                    event.preventDefault()
                    setOpenId((current) => (current === r.id ? null : r.id))
                  }}
                >
                  <td>{r.server_snapshot.name}</td>
                  <td>{enumLabel(c, r.state)}</td>
                  <td>{formatDate(r.created_at, active)}</td>
                  <td>
                    {r.result && typeof r.result === 'object' && 'error' in r.result
                      ? '失败'
                      : r.result && typeof r.result === 'object' && 'summary' in r.result
                        ? enumLabel(serverCopy(active).jobMessages, String(r.result.summary))
                        : r.output_excerpt}
                  </td>
                </tr>
                {openId === r.id && (
                  <tr key={`${r.id}:detail`}>
                    <td className="smp-record-detail" colSpan={4}>
                      <div className="smp-record-section">
                        <h3>{c.remoteChanges}</h3>
                        {r.result === null || r.result === undefined ? (
                          <p className="muted">{r.output_excerpt}</p>
                        ) : (
                          <StructuredValue value={r.result} />
                        )}
                      </div>
                      <div className="smp-record-section">
                        <h3>{c.steps}</h3>
                        <StructuredValue value={r.steps} />
                      </div>
                      <div className="smp-record-actions">
                        <button
                          className="primary"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setPlan(r.plan_id)
                          }}
                        >
                          {c.details}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!records?.items.length && (
              <tr>
                <td colSpan={4} className="empty">{c.emptyRecords}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="smp-server-pager smp-list-pager">
        <span>{format(c.recordsTotal, { count: records?.total ?? 0 })}</span>
        <div className="row">
          <label>
            {ui.perPage}
            <select
              aria-label={ui.perPage}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button className="secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {c.previous}
          </button>
          <span aria-live="polite">{format(ui.page, { page, pages: Math.max(1, Math.ceil((records?.total ?? 0) / pageSize)) })}</span>
          <button
            className="secondary"
            type="button"
            disabled={page * pageSize >= (records?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            {c.next}
          </button>
        </div>
      </footer>
    </Panel>
  )
}

function StructuredValue(props: { value: unknown }) {
  const value = props.value
  if (value === null || value === undefined) return <span className="muted">—</span>
  if (typeof value !== 'object') return <span className="smp-json-scalar">{String(value)}</span>
  if (Array.isArray(value)) {
    return (
      <ul className="smp-json-list">
        {value.map((item, index) => (
          <li key={index}><StructuredValue value={item} /></li>
        ))}
      </ul>
    )
  }
  return (
    <dl className="smp-json-object">
      {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
        <div key={key} className="smp-json-row">
          <dt>{key}</dt>
          <dd><StructuredValue value={child} /></dd>
        </div>
      ))}
    </dl>
  )
}
