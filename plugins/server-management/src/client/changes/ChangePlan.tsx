import { useEffect, useState } from 'react'
import type { PlanView } from '../../shared/dto/changes.ts'
import {
  displayError,
  displayJobError,
  enumLabel,
  formatDate,
  localized,
  serverCopy,
} from '../../shared/i18n.ts'
import { zonedTime } from '../../shared/schedule-time.ts'
import { TableCard } from '@smp/console-kit'
import { Dialog, DialogButton } from '@smp/console-kit/dialog'
import { api, requestError } from '../shared/api.ts'
const localDate = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
export function ChangePlan(props: {
  active: string
  id: string
  onClose: () => void
  onNewPlan?: (id: string) => void
  dialog?: boolean
}) {
  const { active } = props,
    c = serverCopy(active).upgrades
  const [plan, setPlan] = useState<PlanView>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0)
  const [immediate, setImmediate] = useState(true),
    [start, setStart] = useState(localDate(new Date())),
    [end, setEnd] = useState(localDate(new Date(Date.now() + 3600000)))
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone),
    [concurrency, setConcurrency] = useState(1)
  const [replacement, setReplacement] = useState(false),
    [major, setMajor] = useState(false),
    [service, setService] = useState(false)
  useEffect(() => {
    let stopped = false
    const load = () => {
      void api<PlanView>(`/console-api/server-changes/plans/${props.id}`)
        .then((p) => {
          if (!stopped) setPlan(p)
        })
        .catch((cause) => {
          if (!stopped) setError(displayError(active, requestError(cause)))
        })
    }
    load()
    const timer = setInterval(load, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [props.id, tick, active])
  async function act(action: string) {
    setBusy(true)
    setError('')
    try {
      const body =
        action === 'confirm'
          ? {
              revision: plan!.revision,
              review_digest: plan!.review_digest,
              start: immediate ? new Date().toISOString() : zonedTime(start, timezone),
              end: zonedTime(end, timezone),
              timezone,
              concurrency,
              ack_replacement: replacement,
              ack_major: major,
              ack_service_impact: service,
            }
          : {}
      const result = await api<{ id: string }>(`/console-api/server-changes/plans/${props.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (action === 'retry') props.onNewPlan?.(result.id)
      setTick((v) => v + 1)
    } catch (cause) {
      setError(displayError(active, requestError(cause)))
    } finally {
      setBusy(false)
    }
  }
  const changes = plan?.targets.flatMap((t) => t.target_snapshot.changes ?? []) ?? [],
    mutations = changes.filter((ch) => ['install', 'upgrade', 'replace'].includes(ch.action))
  const needsReplacement = mutations.some((ch) => ch.action === 'replace'),
    needsMajor = plan?.targets.some((t) => t.target_snapshot.risks?.major) ?? false,
    needsService = mutations.some((ch) => ch.effects.length)
  const dialogFooter = props.dialog === true && plan !== undefined ? (
    <>
      {plan.state === 'awaiting_confirmation' && (
        <DialogButton
          variant="primary"
          disabled={busy || (needsReplacement && !replacement) || (needsMajor && !major) || (needsService && !service)}
          onClick={() => void act('confirm')}
        >
          {c.confirm}
        </DialogButton>
      )}
      {['scheduled', 'running'].includes(plan.state) && (
        <DialogButton disabled={busy} onClick={() => void act('pause')}>{c.pause}</DialogButton>
      )}
      {['draft', 'awaiting_confirmation', 'scheduled', 'running', 'paused', 'blocked', 'partial_failure'].includes(plan.state) && (
        <DialogButton disabled={busy} onClick={() => void act('cancel')}>{c.cancel}</DialogButton>
      )}
      {['paused', 'blocked', 'partial_failure', 'missed', 'cancelled'].includes(plan.state) && (
        <DialogButton disabled={busy || plan.targets.some((t) => t.state === 'running')} onClick={() => void act('retry')}>
          {c.retry}
        </DialogButton>
      )}
    </>
  ) : undefined
  const body = (
    <section className={`smp-change-plan${props.dialog === true ? ' smp-plan-dialog' : ''}`}>
      <div className="row">
        <h2>
          {c.planId} {props.id.slice(0, 8)}
        </h2>
        <button className="link" onClick={props.onClose}>
          {c.close}
        </button>
      </div>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <>
          <p>
            <b>
              {enumLabel(c, plan.kind)} · {enumLabel(c, plan.state)} · {c.running} (
              {plan.targets.filter((t) => t.state === 'running').length})
            </b>
          </p>
          {plan.targets.length > 1 && <p className="muted">{c.executionHint}</p>}
          {plan.targets.map((t) => (
            <TableCard
              className="smp-plan-target"
              key={t.id}
              title={
                <span className="smp-plan-target-name">
                  {t.server_snapshot.name} <small>{t.server_snapshot.host}</small>
                </span>
              }
              extra={
                <span
                  className={`smp-plan-state ${
                    t.preflight_state === 'failed'
                      ? 'is-failed'
                      : t.state === 'running'
                        ? 'is-running'
                        : t.state === 'pending'
                          ? 'is-pending'
                          : t.state === 'succeeded'
                            ? 'is-success'
                            : 'is-neutral'
                  }`}
                >
                  {enumLabel(c, t.preflight_state)} · {enumLabel(c, t.state)}
                </span>
              }
            >
              {!!t.preflight_error && (
                <p className="banner error">
                  {displayJobError(
                    active,
                    (t.preflight_error as { error?: unknown }).error ?? t.preflight_error,
                  )}
                </p>
              )}
              {(t.target_snapshot.changes ?? []).length ? (
                <div className="smp-upgrade-scroll">
                  <table className="smp-table">
                    <thead>
                      <tr>
                        <th>{c.software}</th>
                        <th>{c.current}</th>
                        <th>{c.target}</th>
                        <th>{c.status}</th>
                        <th>{c.effects}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.target_snapshot.changes.map((ch) => (
                        <tr key={ch.software}>
                          <td>
                            {t.target_snapshot.targetType?.software.find(
                              (s) => s.software_key === ch.software,
                            )?.name_i18n
                              ? localized(
                                  t.target_snapshot.targetType.software.find(
                                    (s) => s.software_key === ch.software,
                                  )!.name_i18n,
                                  active,
                                )
                              : ch.software}
                          </td>
                          <td>{ch.before.state === 'installed' ? ch.before.version : '—'}</td>
                          <td>
                            {ch.target?.version ?? '—'}
                            <small className="mono">{ch.target?.targetIdentity}</small>
                          </td>
                          <td>{enumLabel(c, ch.action)}</td>
                          <td>
                            {ch.effects.map((effect, i) => (
                              <p key={i}>{localized(effect.description, active)}</p>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : t.preflight_state === 'ready' ? (
                <p>{c.noMutation}</p>
              ) : null}
              {(t.target_snapshot.changes ?? [])
                .filter((ch) => ch.target)
                .map((ch) => (
                  <details key={ch.software}>
                    <summary>
                      {ch.software} · {c.dependencies}
                    </summary>
                    <pre>{JSON.stringify(ch.payload, null, 2)}</pre>
                  </details>
                ))}
              {!!t.result && (
                <details>
                  <summary>{c.remoteChanges}</summary>
                  <pre>{JSON.stringify(t.result, null, 2)}</pre>
                </details>
              )}
            </TableCard>
          ))}
          {plan.state === 'awaiting_confirmation' && (
            <div className="smp-plan-confirm">
              <p className="banner ok">{c.preflightReady}</p>
              <label>
                <input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} />
                {c.immediate}
              </label>
              {!immediate && (
                <div className="smp-upgrade-fields">
                  <label className="field">
                    {c.start}
                    <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
                  </label>
                  <label className="field">
                    {c.end}
                    <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </label>
                  <label className="field">
                    {c.timezone}
                    <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                  </label>
                </div>
              )}
              {plan.targets.length > 1 && (
                <div className="smp-upgrade-fields">
                  <label className="field">
                    {c.concurrency}
                    <input
                      type="number"
                      min="1"
                      max="4"
                      value={concurrency}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
              {needsReplacement && (
                <label className="smp-upgrade-ack">
                  <input
                    type="checkbox"
                    checked={replacement}
                    onChange={(e) => setReplacement(e.target.checked)}
                  />
                  {c.ackReplacement}
                </label>
              )}
              {needsMajor && (
                <label className="smp-upgrade-ack">
                  <input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} />
                  {c.ackMajor}
                </label>
              )}
              {needsService && (
                <label className="smp-upgrade-ack">
                  <input type="checkbox" checked={service} onChange={(e) => setService(e.target.checked)} />
                  {c.ackService}
                </label>
              )}
            </div>
          )}
          {plan.state === 'awaiting_confirmation' && (
            <p className="smp-section-hint">{c.confirmHint}</p>
          )}
          {plan.window_start && (
            <p>
              {formatDate(plan.window_start, active)} – {formatDate(plan.window_end, active)} ·{' '}
              {plan.request_snapshot.execution?.timezone}
            </p>
          )}
          <div className="row">
            {plan.state === 'awaiting_confirmation' && props.dialog !== true && (
              <button
                type="button"
                className="primary"
                disabled={
                  busy ||
                  (needsReplacement && !replacement) ||
                  (needsMajor && !major) ||
                  (needsService && !service)
                }
                onClick={() => void act('confirm')}
              >
                {c.confirm}
              </button>
            )}
            {['scheduled', 'running'].includes(plan.state) && (
              <button className="secondary" disabled={busy} onClick={() => void act('pause')}>
                {c.pause}
              </button>
            )}
            {[
              'draft',
              'awaiting_confirmation',
              'scheduled',
              'running',
              'paused',
              'blocked',
              'partial_failure',
            ].includes(plan.state) && (
              <button className="secondary" disabled={busy} onClick={() => void act('cancel')}>
                {c.cancel}
              </button>
            )}
            {['paused', 'blocked', 'partial_failure', 'missed', 'cancelled'].includes(plan.state) && (
              <button
                className="secondary"
                disabled={busy || plan.targets.some((t) => t.state === 'running')}
                onClick={() => void act('retry')}
              >
                {c.retry}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
  if (props.dialog === true)
    return (
      <Dialog
        open
        title={`${c.planId} ${props.id.slice(0, 8)}`}
        closeLabel={c.close}
        onClose={props.onClose}
        className="smp-dialog-plan"
        footer={dialogFooter}
      >
        {body}
      </Dialog>
    )
  return body
}
