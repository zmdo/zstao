import type { TaskDto, TaskPageDto, TaskResultDto } from '../../../shared/dto/tasks.ts'
import { useEffect, useState } from 'react'
import { type ServerError } from '../../../shared/errors.ts'
import {
  displayError,
  displayJobError,
  enumLabel,
  format,
  formatDate,
  serverCopy,
} from '../../../shared/i18n.ts'
import { api, requestError } from '../../shared/api.ts'
import { emptyTaskView, type TaskViewState } from '../../shared/server-page-state.ts'
import { taskQuery } from './query.ts'
type TaskRow = TaskDto<TaskResultDto | null>
type TaskPage = TaskPageDto<TaskResultDto | null>

export interface TaskHistoryProps {
  active: string
  serverId: string
  view: TaskViewState
  onView: (view: TaskViewState) => void
  refresh?: number
}

/** Rendered only while the task panel is active, so its polling stops when the panel is left. */
export function TaskHistory(props: TaskHistoryProps) {
  const { active, serverId, view, onView } = props
  const copy = serverCopy(active).ui
  const [draft, setDraft] = useState(() => ({
    query: view.query,
    action: view.action,
    status: view.status,
    from: view.from,
    to: view.to,
  }))
  const [loaded, setLoaded] = useState<{ key: string; data: TaskPage }>()
  const [error, setError] = useState<ServerError | null>(null)
  const key = taskQuery(serverId, view)
  const data = loaded?.key === key ? loaded.data : undefined

  // Filters are live; typing is debounced briefly so each keystroke does not hit the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      onView({
        ...view,
        query: draft.query,
        action: draft.action,
        status: draft.status,
        from: draft.from,
        to: draft.to,
        page: 1,
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [draft.query, draft.action, draft.status, draft.from, draft.to])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    setError(null)
    async function load() {
      try {
        const next = await api<TaskPage>(`/console-api/server-jobs?${key}`, { signal: controller.signal })
        if (!stopped) {
          setLoaded({ key, data: next })
          setError(null)
        }
      } catch (cause) {
        if (!stopped) setError(requestError(cause))
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void load()
          }, 5000)
      }
    }
    void load()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [key, props.refresh])

  function reset() {
    const next = emptyTaskView(view.pageSize)
    setDraft({ query: '', action: '', status: '', from: '', to: '' })
    onView({ ...next, page: 1 })
  }

  const page = data?.page ?? view.page
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / view.pageSize))
  return (
    <section className="smp-task-history" aria-label={copy.taskReport}>
      <div className="smp-task-top">
      <form className="smp-task-filters" onSubmit={(event) => event.preventDefault()}>
        <input
          type="search"
          aria-label={copy.taskKeyword}
          maxLength={200}
          placeholder={copy.searchTasks}
          value={draft.query}
          onChange={(event) => setDraft({ ...draft, query: event.target.value })}
        />
        <select
          aria-label={copy.taskType}
          value={draft.action}
          onChange={(event) => setDraft({ ...draft, action: event.target.value })}
        >
          <option value="">{copy.allTypes}</option>
          {Object.entries(serverCopy(active).actions).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label={copy.status}
          value={draft.status}
          onChange={(event) => setDraft({ ...draft, status: event.target.value })}
        >
          <option value="">{copy.allStatuses}</option>
          {Object.entries(serverCopy(active).jobStatus).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="smp-task-date-range" role="group" aria-label={`${copy.taskFrom} – ${copy.taskTo}`}>
          <input
            type="datetime-local"
            aria-label={copy.taskFrom}
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
          <span aria-hidden="true">–</span>
          <input
            type="datetime-local"
            aria-label={copy.taskTo}
            min={draft.from || undefined}
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </div>
        <button className="secondary" type="button" onClick={reset}>
          {copy.reset}
        </button>
      </form>
      {error && (
        <p className="banner error" role="alert">
          {displayError(active, error)}
        </p>
      )}
      </div>
      <div className="table-scroll" aria-busy={!data && !error}>
        <table className="smp-task-table smp-table">
          <thead>
            <tr>
              <th>{copy.createdAt}</th>
              <th>{copy.taskType}</th>
              <th>{copy.status}</th>
              <th>{copy.taskDetails}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((job) => (
              <tr key={job.id}>
                <td>{formatDate(job.created_at, active)}</td>
                <td title={job.action === 'inspection_report' ? undefined : job.id}>
                  {enumLabel(serverCopy(active).actions, job.action)}
                </td>
                <td>
                  <span className={`pill ${job.status}`}>
                    {enumLabel(serverCopy(active).jobStatus, job.status)}
                  </span>
                </td>
                <td>
                  <TaskResult active={active} job={job} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data ? (
          <p className="empty">{error ? copy.cannotLoadTasks : copy.loading}</p>
        ) : (
          data.items.length === 0 && <p className="empty">{copy.noTasks}</p>
        )}
      </div>
      <div className="smp-server-pager smp-task-pager" aria-label={copy.taskPagination}>
        <span>
          {format(data?.total ? copy.taskRange : copy.taskTotal, {
            count: data?.total ?? 0,
            from: (page - 1) * view.pageSize + 1,
            to: Math.min(page * view.pageSize, data?.total ?? 0),
          })}
        </span>
        <div className="row">
          <label>
            {copy.perPage}
            <select
              aria-label={copy.tasksPageSize}
              value={view.pageSize}
              onChange={(event) => onView({ ...view, pageSize: Number(event.target.value), page: 1 })}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            type="button"
            disabled={!data || page <= 1}
            onClick={() => onView({ ...view, page: page - 1 })}
          >
            {copy.previous}
          </button>
          <span aria-live="polite">{format(copy.page, { page, pages })}</span>
          <button
            className="secondary"
            type="button"
            disabled={!data || page >= pages}
            onClick={() => onView({ ...view, page: page + 1 })}
          >
            {copy.next}
          </button>
        </div>
      </div>
    </section>
  )
}

function TaskResult({ active, job }: { active: string; job: TaskRow }) {
  const copy = serverCopy(active)
  const result = job.result
  return (
    <>
      {job.action === 'inspection_report' && result ? (
        <>
          {format(copy.ui.inspectionReport, { succeeded: result.succeeded ?? 0, failed: result.failed ?? 0 })}
          <small className="muted">
            {formatDate(result.hour_start ?? null, active)} – {formatDate(result.hour_end ?? null, active)}
          </small>
        </>
      ) : result?.error ? (
        displayJobError(active, result.error)
      ) : result?.summary ? (
        enumLabel(copy.jobMessages, result.summary)
      ) : job.status === 'recovering' ? (
        copy.jobMessages.recovering
      ) : (
        job.output_excerpt
      )}
      {result?.issues?.length ? (
        <ul>
          {result.issues.map((issue, index) => (
            <li key={index}>{displayJobError(active, issue)}</li>
          ))}
        </ul>
      ) : null}
      {result?.extensions?.length ? (
        <ul>
          {result.extensions.map((item) => (
            <li key={item.key}>
              {item.key}: {enumLabel(copy.jobStatus, item.status)}
              {item.error !== undefined ? ` — ${displayJobError(active, item.error)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {['queued', 'claimed', 'running', 'recovering'].includes(job.status) && (
        <button
          className="link"
          type="button"
          onClick={() => {
            void api(`/console-api/server-jobs/${job.id}/cancel`, { method: 'POST' })
          }}
        >
          {copy.cancelTask}
        </button>
      )}
      {result?.steps && (
        <ul>
          {result.steps.map((step) => (
            <li key={step.ordinal}>
              {step.software}: {enumLabel(copy.jobStatus, step.state)}
              {step.after?.version ? ` (${step.after.version})` : ''}
              {step.changes?.length ? (
                <small>
                  {' '}
                  —{' '}
                  {step.changes
                    .map((change) => `${change.name ?? ''}${change.version ? ` ${change.version}` : ''}`)
                    .filter(Boolean)
                    .join(', ')}
                </small>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
