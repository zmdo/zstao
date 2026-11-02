import type { TaskViewState } from '../../shared/server-page-state.ts'

/** Query string for the task history endpoint. Kept pure so filters can be tested without React. */
export function taskQuery(serverId: string, view: TaskViewState): string {
  const params = new URLSearchParams({
    server_id: serverId,
    q: view.query,
    action: view.action,
    status: view.status,
    page: String(view.page),
    page_size: String(view.pageSize),
  })
  if (view.from) params.set('from', new Date(view.from).toISOString())
  if (view.to) params.set('to', new Date(view.to).toISOString())
  return params.toString()
}
