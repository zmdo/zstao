import { useEffect, useState } from 'react'
import { detectionResult } from '../../../shared/detection-result.ts'
import { type DetectionResult } from '../../../shared/dto/upgrades.ts'
import { format, formatDate, serverCopy } from '../../../shared/i18n.ts'
import { TableCard } from '@smp/console-kit'
export function DetectionResults(props: {
  active: string
  checks: readonly DetectionResult[]
  loading: boolean
  failuresOnly: boolean
  softwareName: (key: string) => string
}) {
  const copy = serverCopy(props.active).upgrades
  const ui = serverCopy(props.active).ui
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const rows = props.checks
    .map((check) => ({ check, ...detectionResult(props.active, check) }))
    .filter((row) => !props.failuresOnly || row.state === 'failed')
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * pageSize, current * pageSize)
  useEffect(() => { setPage(1) }, [props.checks, props.failuresOnly])
  return (
    <TableCard className="smp-detection-results" title={copy.checks} extra={format(copy.checkCount, { count: rows.length })} ariaLabel={copy.checks}>
      <div className="smp-detection-scroll" aria-busy={props.loading}>
        <table className="smp-detection-table smp-table">
          <thead>
            <tr>
              <th scope="col">{copy.server}</th>
              <th scope="col">{copy.software}</th>
              <th scope="col">{copy.status}</th>
              <th scope="col">{copy.checkedAt}</th>
              <th scope="col">{copy.checkReason}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ check, state, label, reasons }) => (
              <tr key={`${check.server_id}/${check.software_key}`}>
                <td>
                  <b>{check.server_name}</b>
                  {check.host && <small className="mono">{check.host}</small>}
                </td>
                <td>{props.softwareName(check.software_key)}</td>
                <td>
                  <span className={`smp-detection-status ${state}`}>{label}</span>
                </td>
                <td className="smp-detection-time">{formatDate(check.last_check_at, props.active)}</td>
                <td>
                  <ul className="smp-detection-reasons">
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="smp-upgrade-empty">
                  {props.loading
                    ? serverCopy(props.active).ui.loading
                    : props.failuresOnly
                      ? copy.noCheckFailures
                      : copy.noChecks}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <footer className="smp-server-pager smp-detection-pager" aria-label={copy.checks}>
          <span>
            {format(ui.checkRange, {
              count: rows.length,
              from: (current - 1) * pageSize + 1,
              to: Math.min(current * pageSize, rows.length),
            })}
          </span>
          <div className="row">
            <label>
              {ui.perPage}
              <select
                aria-label={ui.checkPageSize}
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
              {ui.previous}
            </button>
            <span aria-live="polite">{format(ui.page, { page: current, pages })}</span>
            <button className="secondary" type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              {ui.next}
            </button>
          </div>
        </footer>
      )}
    </TableCard>
  )
}
