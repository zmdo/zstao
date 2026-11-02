/** Task timestamps on the HTTP wire are strings; arbitrary recipe results remain opaque. */
export interface TaskDto<TResult = unknown> {
  id: string
  action: string
  status: string
  phase: string
  output_excerpt: string
  result: TResult
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface TaskPageDto<TResult = unknown> {
  items: TaskDto<TResult>[]
  page: number
  page_size: number
  total: number
}

/** Fields understood by the task history renderer. */
export interface TaskResultDto {
  summary?: string
  error?: unknown
  issues?: unknown[]
  extensions?: {
    key: string
    owner: string
    status: 'succeeded' | 'failed'
    result?: unknown
    error?: unknown
  }[]
  hour_start?: string
  hour_end?: string
  succeeded?: number
  failed?: number
  steps?: {
    ordinal: number
    software: string
    state: string
    after?: { version?: string }
    changes?: { name?: string; version?: string }[]
  }[]
}
