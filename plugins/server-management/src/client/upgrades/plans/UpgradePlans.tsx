import { Panel } from '@smp/console-kit'
import { useState, type ReactNode } from 'react'
import type { PlanSummary } from '../../../shared/dto/changes.ts'
import { displayError, enumLabel, format, formatDate, serverCopy } from '../../../shared/i18n.ts'
import { api, requestError } from '../../shared/api.ts'
import { usePollingResource } from '../../shared/usePollingResource.ts'

const CANCELLABLE = new Set([
  'draft',
  'awaiting_confirmation',
  'scheduled',
  'running',
  'paused',
  'blocked',
  'partial_failure',
])
const STATUS_OPTIONS = [
  'awaiting_confirmation',
  'scheduled',
  'running',
  'paused',
  'blocked',
  'partial_failure',
  'missed',
  'succeeded',
  'failed',
  'cancelled',
] as const

export function UpgradePlans(props: { active: string; onPlan: (id: string) => void; back?: ReactNode }) {
  const active = props.active,
    c = serverCopy(active).upgrades,
    copy = serverCopy(active).ui
  const { data, error } = usePollingResource<PlanSummary[]>('/console-api/server-changes/plans')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const plans = (data ?? []).filter(
    (plan) => !hidden.has(plan.id) && (status === '' || plan.state === status),
  )
  const pages = Math.max(1, Math.ceil(plans.length / pageSize))
  const current = Math.min(page, pages)
  const rows = plans.slice((current - 1) * pageSize, current * pageSize)
  const selectable = rows.filter((plan) => CANCELLABLE.has(plan.state))
  const allSelected = selectable.length > 0 && selectable.every((plan) => selected.has(plan.id))

  function toggle(id: string): void {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function cancelSelected(): Promise<void> {
    if (busy || selected.size === 0) return
    setBusy(true)
    setBulkError(null)
    const ids = [...selected]
    const results = await Promise.allSettled(
      ids.map((id) => api(`/console-api/server-changes/plans/${id}/cancel`, { method: 'POST' })),
    )
    const cancelled = ids.filter((_, index) => results[index]?.status === 'fulfilled')
    setHidden((previous) => new Set([...previous, ...cancelled]))
    setSelected(new Set())
    if (cancelled.length !== ids.length) {
      const failed = results.find((result) => result.status === 'rejected')
      setBulkError(
        failed?.status === 'rejected'
          ? displayError(active, requestError(failed.reason))
          : c.bulkCancelFailed,
      )
    }
    setBusy(false)
  }

  return (
    <Panel
      className="smp-upgrade-page smp-list-panel"
      title={c.plans}
      extra={
        <div className="row smp-plan-head-extra">
          <select
            className="smp-plan-status-filter"
            aria-label={copy.status}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
              setSelected(new Set())
            }}
          >
            <option value="">{c.planAllStates}</option>
            {STATUS_OPTIONS.map((state) => (
              <option key={state} value={state}>{enumLabel(c, state)}</option>
            ))}
          </select>
          <button
            className="secondary"
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => { void cancelSelected() }}
          >
            {busy ? c.bulkCancelling : c.bulkCancel}
          </button>
          {props.back}
        </div>
      }
    >
      {(error !== null || bulkError !== null) && (
        <p className="banner error" role="alert">
          {bulkError ?? (error === null ? '' : displayError(active, error))}
        </p>
      )}
      <div className="smp-list-scroll">
        <table className="smp-table smp-plans-table">
          <thead>
            <tr>
              <th className="smp-select-col">
                <input
                  type="checkbox"
                  aria-label={c.selectAllPlans}
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={(event) => {
                    setSelected((previous) => {
                      const next = new Set(previous)
                      for (const plan of selectable) {
                        if (event.target.checked) next.add(plan.id)
                        else next.delete(plan.id)
                      }
                      return next
                    })
                  }}
                />
              </th>
              <th>{c.planId}</th>
              <th>{c.type}</th>
              <th>{c.status}</th>
              <th>{c.server}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((plan) => {
              const canCancel = CANCELLABLE.has(plan.state)
              return (
                <tr
                  key={plan.id}
                  className="smp-plan-row"
                  role="button"
                  aria-label={`${plan.id.slice(0, 8)} ${enumLabel(c, plan.state)}`}
                  tabIndex={0}
                  onClick={() => props.onPlan(plan.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    if ((event.target as HTMLElement).closest('input, button, a, select')) return
                    event.preventDefault()
                    props.onPlan(plan.id)
                  }}
                >
                  <td className="smp-select-col">
                    <input
                      type="checkbox"
                      aria-label={c.selectPlan}
                      checked={selected.has(plan.id)}
                      disabled={!canCancel}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggle(plan.id)}
                    />
                  </td>
                  <td className="mono">
                    {plan.id.slice(0, 8)}
                    <small>{formatDate(plan.created_at, active)}</small>
                  </td>
                  <td>{enumLabel(c, plan.kind)}</td>
                  <td>{enumLabel(c, plan.state)}</td>
                  <td>
                    {plan.succeeded_count}/{plan.target_count}
                    {plan.running_count > 0 && (
                      <small>{c.running} ({plan.running_count})</small>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">{c.noPlans}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {plans.length > 0 && (
        <footer className="smp-server-pager smp-list-pager" aria-label={c.planPagination}>
          <span>
            {format(plans.length ? c.planRange : c.planTotal, {
              count: plans.length,
              from: (current - 1) * pageSize + 1,
              to: Math.min(current * pageSize, plans.length),
            })}
          </span>
          <div className="row">
            <label>
              {copy.perPage}
              <select
                aria-label={c.planPageSize}
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                  setSelected(new Set())
                }}
              >
                {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button className="secondary" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              {copy.previous}
            </button>
            <span aria-live="polite">{format(copy.page, { page: current, pages })}</span>
            <button className="secondary" type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              {copy.next}
            </button>
          </div>
        </footer>
      )}
    </Panel>
  )
}
