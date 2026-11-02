import { SERVER_STATES } from '../../shared/server-status.ts'
import { HttpError } from '../errors.ts'
import { type ServerListQuery } from '../servers/query.ts'

export function parseServerListQuery(params: URLSearchParams): ServerListQuery {
  const group = params.get('group_id')
  const groupId = group === null ? null : group === 'ungrouped' ? '' : group
  const query = (params.get('q') ?? '').trim()
  const status = params.get('status') ?? ''
  const order = params.get('order') ?? 'name'
  if (
    (groupId !== null &&
      groupId !== '' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) ||
    query.length > 200 ||
    (status && !SERVER_STATES.some((value) => value === status)) ||
    (order !== 'name' && order !== 'last_checked')
  )
    throw new HttpError(422, 'server_query_invalid')
  function integer(key: string, fallback: number, maximum: number) {
    const value = params.get(key)
    if (value === null) return fallback
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum)
      throw new HttpError(422, 'server_query_invalid')
    return Number(value)
  }
  return {
    needsUpgrade: params.get('needs_upgrade') === 'true',
    groupId,
    query,
    status: status as ServerListQuery['status'],
    order,
    page: integer('page', 1, 1_000_000),
    pageSize: integer('page_size', 10, 100),
  }
}
