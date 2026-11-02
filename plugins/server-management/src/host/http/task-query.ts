import { HttpError } from '../errors.ts'
import { type TaskQuery } from '../tasks/query.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = [
  'inspect',
  'inspection_report',
  'test_connection',
  'install_components',
  'detect_updates',
  'preflight_move',
  'preflight_upgrade',
  'move_server',
  'upgrade_software',
  'deploy',
  'start',
  'stop',
  'restart',
  'logs',
]
const STATES = ['queued', 'claimed', 'running', 'recovering', 'succeeded', 'failed', 'blocked', 'cancelled']

export function parseTaskQuery(params: URLSearchParams): TaskQuery {
  const serverId = params.get('server_id') ?? ''
  const query = (params.get('q') ?? '').trim()
  const action = params.get('action') ?? ''
  const status = params.get('status') ?? ''
  function integer(key: string, fallback: number, maximum: number): number {
    const value = params.get(key)
    if (value === null) return fallback
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum)
      throw new HttpError(422, 'task_query_invalid')
    return Number(value)
  }
  function date(key: string): string | null {
    const value = params.get(key)
    if (!value) return null
    if (
      value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new HttpError(422, 'task_query_invalid')
    return new Date(value).toISOString()
  }
  const from = date('from'),
    to = date('to')
  if (
    !UUID.test(serverId) ||
    query.length > 200 ||
    (action && !ACTIONS.includes(action)) ||
    (status && !STATES.includes(status)) ||
    (from && to && from >= to)
  )
    throw new HttpError(422, 'task_query_invalid')
  return {
    serverId,
    query,
    action,
    status,
    from,
    to,
    page: integer('page', 1, 1_000_000),
    pageSize: integer('page_size', 10, 100),
  }
}
