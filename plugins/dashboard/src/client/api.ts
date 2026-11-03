import type { CsvImportResult, DashboardSummary, SummaryQuery, TransactionPage, TransactionQuery } from '../shared/contracts.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init })
  const body = await response.json() as { detail?: unknown }
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`)
  return body as T
}

export function summary(query: SummaryQuery, signal?: AbortSignal): Promise<DashboardSummary> {
  const search = new URLSearchParams({ range: query.range, currency: query.currency })
  return request<DashboardSummary>(`/console-api/dashboard/summary?${search.toString()}`, { signal })
}

export function transactions(query: TransactionQuery, signal?: AbortSignal): Promise<TransactionPage> {
  const search = new URLSearchParams({ range: query.range, currency: query.currency, limit: String(query.limit) })
  if (query.cursor !== undefined) search.set('cursor', query.cursor)
  if (query.type !== undefined && query.type !== 'all') search.set('type', query.type)
  if (query.source !== undefined && query.source !== '') search.set('source', query.source)
  if (query.accountId !== undefined && query.accountId !== '') search.set('accountId', query.accountId)
  if (query.status !== undefined && query.status !== 'all') search.set('status', query.status)
  return request<TransactionPage>(`/console-api/dashboard/transactions?${search.toString()}`, { signal })
}

export function importCsv(text: string, signal?: AbortSignal): Promise<CsvImportResult> {
  return request<CsvImportResult>('/console-api/dashboard/import/csv', {
    method: 'POST',
    headers: { 'content-type': 'text/csv; charset=utf-8' },
    body: text,
    signal,
  })
}
