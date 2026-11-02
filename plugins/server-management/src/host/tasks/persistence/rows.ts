/** The JSON aggregation is decoded by PostgreSQL; timestamps inside JSON are strings. */
export interface TaskHistoryPageRow {
  items: TaskHistoryEntryRow[]
  total: number
  page: number
  page_size: number
}

export interface TaskHistoryEntryRow {
  id: string
  action: string
  status: string
  phase: string
  result: unknown
  output_excerpt: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}
