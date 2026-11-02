import { Panel } from '@smp/console-kit'
import { Fragment, useState } from 'react'
import type { AuditPageDto } from '../../shared/dto/audit.ts'
import { displayError, format, formatDate, serverCopy, type LocaleFace } from '../../shared/i18n.ts'
import { useActiveLocale } from '../shared/locale.ts'
import { usePollingResource } from '../shared/usePollingResource.ts'

const STATUS_KEYS = {
  pending: 'auditPending',
  succeeded: 'auditSucceeded',
  failed: 'auditFailed',
  denied: 'auditDenied',
  timeout: 'auditTimeout',
  cancelled: 'auditCancelled',
} as const

export function AuditPage(props: {
  locale: LocaleFace
  openConsole?: (key: string) => void
  pageState?: { openServer(id: string): void }
}) {
  const active = useActiveLocale(props.locale)
  const c = serverCopy(active).ui
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [kind, setKind] = useState('')
  const [hours, setHours] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const { data, error } = usePollingResource<AuditPageDto>(
    `/console-api/server-audits?page=${page}&page_size=${pageSize}&kind=${encodeURIComponent(kind)}&hours=${hours}`,
  )
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pages)
  const statusLabel = (status: string) =>
    status in STATUS_KEYS ? c[STATUS_KEYS[status as keyof typeof STATUS_KEYS]] : status
  const kindLabel = (value: string) =>
    value === 'admin' ? c.auditKindAdmin : value === 'command' ? c.auditKindCommand : value === 'upload' ? c.auditKindUpload : value === 'transfer' ? c.auditKindTransfer : c.auditKindDownload
  const target = (record: AuditPageDto['items'][number]) =>
    record.kind === 'admin' ? String(record.metadata?.action ?? '') : record.kind === 'command' || record.kind === 'transfer' ? record.command : record.remote_path
  return (
    <Panel
      className="smp-upgrade-page smp-list-panel smp-audit-page"
      title={c.auditTitle}
      extra={
        <div className="row smp-records-tools">
          <select
            aria-label={c.auditKind}
            value={kind}
            onChange={(event) => { setKind(event.target.value); setPage(1); setOpenId(null) }}
          >
            <option value="">{c.auditAllKinds}</option>
            <option value="command">{c.auditKindCommand}</option>
            <option value="upload">{c.auditKindUpload}</option>
            <option value="download">{c.auditKindDownload}</option>
            <option value="transfer">{c.auditKindTransfer}</option>
            <option value="admin">{c.auditKindAdmin}</option>
          </select>
          <select
            aria-label={c.auditTimeRange}
            value={hours}
            onChange={(event) => { setHours(event.target.value); setPage(1); setOpenId(null) }}
          >
            <option value="">{c.auditAllTime}</option>
            <option value="24">{c.auditLast24h}</option>
            <option value="168">{c.auditLast7d}</option>
            <option value="720">{c.auditLast30d}</option>
          </select>
        </div>
      }
    >
      {error && (
        <p className="banner error" role="alert">
          {displayError(active, error)}
        </p>
      )}
      <div className="smp-list-scroll">
        <table className="smp-table smp-records-table smp-audit-table">
          <thead>
            <tr>
              <th>{c.auditTime}</th>
              <th>{c.auditKind}</th>
              <th>{c.auditSessionId}</th>
              <th>{c.auditServer}</th>
              <th>{c.auditTarget}</th>
              <th>{c.auditStatus}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((record) => (
              <Fragment key={record.id}>
                <tr
                  className={openId === record.id ? 'smp-record-row is-open' : 'smp-record-row'}
                  role="button"
                  aria-expanded={openId === record.id}
                  tabIndex={0}
                  onClick={() => setOpenId((current) => current === record.id ? null : record.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    if ((event.target as HTMLElement).closest('button, a, input, select')) return
                    event.preventDefault()
                    setOpenId((current) => current === record.id ? null : record.id)
                  }}
                >
                  <td>{formatDate(record.started_at, active)}</td>
                  <td>{kindLabel(record.kind)}</td>
                  <td className="smp-audit-session" title={record.harness_session_id ?? ''}>
                    {record.harness_session_id === null ? (record.actor_kind === 'system' ? 'system' : '—') : (
                      <button
                        className="smp-audit-session-link"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          window.sessionStorage.setItem('smp.archive.search', JSON.stringify({ by: 'id', query: record.harness_session_id }))
                          props.openConsole?.('archive')
                        }}
                      >
                        {record.harness_session_id}
                      </button>
                    )}
                  </td>
                  <td title={`${c.auditSnapshotName}: ${record.server_name}`}>
                    {record.kind === 'admin' && record.server_name === null ? <span>{String(record.metadata?.target_id ?? '—')}</span> : record.server_deleted ? (
                      <span className="smp-audit-server-deleted">
                        {record.server_name} <span className="smp-audit-deleted">{c.auditServerDeleted}</span>
                      </span>
                    ) : (
                      <button
                        className="smp-audit-server-link"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (record.server_id === null || props.pageState === undefined) return
                          props.pageState.openServer(record.server_id)
                          props.openConsole?.('servers')
                        }}
                      >
                        {record.current_server_name ?? record.server_name}
                      </button>
                    )}
                  </td>
                  <td className="smp-audit-command" title={target(record) ?? ''}>{target(record)}</td>
                  <td>
                    <span className={`smp-audit-status is-${record.status}`}>{statusLabel(record.status)}</span>
                  </td>
                </tr>
                {openId === record.id && (
                  <tr>
                    <td className="smp-record-detail" colSpan={6}>
                      <AuditDetail record={record} active={active} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!data?.items.length && (
              <tr>
                <td colSpan={6} className="empty">{c.auditEmpty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="smp-server-pager smp-list-pager">
        <span>{format(c.auditTotal, { count: total })}</span>
        <div className="row">
          <label>
            {c.perPage}
            <select
              aria-label={c.perPage}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button className="secondary" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>
            {c.previous}
          </button>
          <span aria-live="polite">{format(c.auditPage, { page: current, pages })}</span>
          <button
            className="secondary"
            type="button"
            disabled={current >= pages}
            onClick={() => setPage(current + 1)}
          >
            {c.next}
          </button>
        </div>
      </footer>
    </Panel>
  )
}


function AuditDetail(props: { record: AuditPageDto['items'][number]; active: string }) {
  const { record: r, active } = props
  const c = serverCopy(active).ui
  const value = (v: string | number | null | undefined) => v === null || v === undefined || v === '' ? '—' : String(v)
  return (
    <div className="smp-audit-detail">
      <section className="smp-record-section">
        <h3>{c.auditBasic}</h3>
        <dl className="smp-json-object">
          <div className="smp-json-row"><dt>{c.auditCurrentServer}</dt><dd>{value(r.current_server_name ?? r.server_name)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditSnapshotName}</dt><dd>{value(r.server_name)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditHost}</dt><dd>{value(r.host)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditSessionId}</dt><dd>{value(r.harness_session_id)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditAgent}</dt><dd>{value(r.agent_id)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditTool}</dt><dd>{value(r.tool_name)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditCall}</dt><dd>{value(r.tool_call_id)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditRootCall}</dt><dd>{value(r.root_tool_call_id)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditTurn}</dt><dd>{value(r.harness_turn)} / {value(r.harness_step)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditEventSeq}</dt><dd>{value(r.harness_event_seq)}</dd></div>
        </dl>
      </section>
      <section className="smp-record-section">
        <h3>{c.auditApproval}</h3>
        <dl className="smp-json-object">
          <div className="smp-json-row"><dt>{c.auditPermission}</dt><dd>{value(r.permission_mode)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditAuthorizationSource}</dt><dd>{r.metadata?.authorization_source === 'full-access' ? c.auditFullAccess : r.metadata?.authorization_source === 'user-approval' ? c.auditUserApproval : '—'}</dd></div>
          <div className="smp-json-row"><dt>{c.auditApprovalStatus}</dt><dd>{r.approval_status === 'not_required' ? c.auditApprovalNotRequired : value(r.approval_status)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditApprovedBy}</dt><dd>{value(r.approved_by)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditApprovedAt}</dt><dd>{formatDate(r.approved_at, active)}</dd></div>
          <div className="smp-json-row"><dt>{c.auditApprovalReason}</dt><dd>{value(r.approval_reason)}</dd></div>
        </dl>
      </section>
      {r.kind === 'admin' ? <section className="smp-record-section"><h3>{c.auditKindAdmin}</h3><pre className="smp-audit-pre">{JSON.stringify(r.metadata,null,2)}</pre></section> : r.kind === 'command' ? (
        <section className="smp-record-section">
          <h3>{c.auditCommandDetail}</h3>
          <dl className="smp-json-object">
            <div className="smp-json-row"><dt>{c.auditCommand}</dt><dd><pre className="smp-audit-pre">{value(r.command)}</pre></dd></div>
            <div className="smp-json-row"><dt>{c.auditDigest}</dt><dd>{value(r.command_digest)}</dd></div>
            <div className="smp-json-row"><dt>{c.auditExitCode}</dt><dd>{value(r.exit_code)}</dd></div>
            <div className="smp-json-row"><dt>stdout</dt><dd><pre className="smp-audit-pre">{value(r.stdout_excerpt)}</pre></dd></div>
            <div className="smp-json-row"><dt>stderr</dt><dd><pre className="smp-audit-pre">{value(r.stderr_excerpt)}</pre></dd></div>
          </dl>
        </section>
      ) : (
        <section className="smp-record-section">
          <h3>{c.auditFileDetail}</h3>
          <dl className="smp-json-object">
            <div className="smp-json-row"><dt>{c.auditRemotePath}</dt><dd><code>{value(r.remote_path)}</code></dd></div>
            <div className="smp-json-row"><dt>{c.auditLocalPath}</dt><dd><code>{value(r.local_path)}</code></dd></div>
            <div className="smp-json-row"><dt>{c.auditBytes}</dt><dd>{value(r.bytes)}</dd></div>
            <div className="smp-json-row"><dt>{c.auditMode}</dt><dd>{value(r.mode)}</dd></div>
            <div className="smp-json-row"><dt>{c.auditOverwrite}</dt><dd>{r.overwrite ? c.auditYes : c.auditNo}</dd></div>
          </dl>
        </section>
      )}
      <section className="smp-record-section">
        <h3>{c.auditResult}</h3>
        <dl className="smp-json-object">
          <div className="smp-json-row"><dt>{c.auditStatus}</dt><dd>{r.status}</dd></div>
          <div className="smp-json-row"><dt>{c.auditDuration}</dt><dd>{r.duration_ms === null ? '—' : `${r.duration_ms} ms`}</dd></div>
          <div className="smp-json-row"><dt>{c.auditTimedOut}</dt><dd>{r.timed_out ? c.auditYes : c.auditNo}</dd></div>
          <div className="smp-json-row"><dt>{c.auditCancelled}</dt><dd>{r.cancelled ? c.auditYes : c.auditNo}</dd></div>
          <div className="smp-json-row"><dt>{c.auditError}</dt><dd><pre className="smp-audit-pre">{value(r.error_message)}</pre></dd></div>
        </dl>
      </section>
    </div>
  )
}
