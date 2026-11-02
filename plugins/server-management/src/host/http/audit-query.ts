import { HttpError } from '../errors.ts'

const STATUSES = new Set(['pending', 'succeeded', 'failed', 'denied', 'timeout', 'cancelled'])
const KINDS = new Set(['command', 'upload', 'download', 'transfer', 'admin'])
const HOURS = new Set([0, 24, 168, 720])

export function parseAuditQuery(params: URLSearchParams) {
  const page = Number(params.get('page') ?? 1)
  const pageSize = Number(params.get('page_size') ?? 20)
  const status = params.get('status') ?? ''
  const hours = Number(params.get('hours') ?? 0)
  const kind = params.get('kind') ?? ''
  if (!Number.isSafeInteger(page) || page < 1) throw new HttpError(422, 'audit_invalid')
  if (pageSize !== 10 && pageSize !== 20 && pageSize !== 50) throw new HttpError(422, 'audit_invalid')
  if (status !== '' && !STATUSES.has(status)) throw new HttpError(422, 'audit_invalid')
  if (kind !== '' && !KINDS.has(kind)) throw new HttpError(422, 'audit_invalid')
  if (!HOURS.has(hours)) throw new HttpError(422, 'audit_invalid')
  return {
    page,
    pageSize,
    query: (params.get('q') ?? '').trim().slice(0, 200),
    status,
    kind,
    since: hours > 0 ? new Date(Date.now() - hours * 3600_000) : null,
  }
}
