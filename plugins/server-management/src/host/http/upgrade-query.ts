import { HttpError } from '../errors.ts'
import { type SuggestionQuery } from '../upgrades/query.ts'

export function parseUpgradePage(params: URLSearchParams): number {
  const page = Math.max(1, Number(params.get('page') ?? 1))
  if (!Number.isSafeInteger(page)) throw new HttpError(422, 'upgrade_invalid')
  return page
}
export function parseSuggestionQuery(params: URLSearchParams): SuggestionQuery {
  return {
    page: parseUpgradePage(params),
    query: (params.get('q') ?? '').toLowerCase(),
    decision: params.get('decision') ?? '',
    group: params.get('group_id'),
    type: params.get('type_key'),
    software: params.get('software'),
    connection: params.get('connection'),
    current: params.get('current'),
    target: params.get('target'),
    server: params.get('server_id'),
  }
}

export function parseUpgradePageSize(params: URLSearchParams): number {
  const size = Number(params.get('page_size') ?? 20)
  if (size !== 10 && size !== 20 && size !== 50) throw new HttpError(422, 'upgrade_invalid')
  return size
}

export function parseRecordFilter(params: URLSearchParams): {
  query: string
  state: string
  since: Date | null
} {
  const query = (params.get('q') ?? '').trim().slice(0, 200)
  const state = params.get('status') ?? ''
  const hours = Number(params.get('hours') ?? 0)
  const allowed = [0, 24, 168, 720]
  if (!allowed.includes(hours)) throw new HttpError(422, 'upgrade_invalid')
  return {
    query,
    state,
    since: hours > 0 ? new Date(Date.now() - hours * 3600_000) : null,
  }
}
