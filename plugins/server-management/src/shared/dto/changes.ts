import type { ChangeRequest, PreparedPlan } from '../changes.ts'

export interface PlanSummary {
  id: string
  kind: string
  state: string
  created_at: string
  target_count: number
  succeeded_count: number
  running_count: number
}

export interface PlanView {
  id: string
  kind: string
  state: string
  revision: string
  review_digest: string
  request_snapshot: ChangeRequest
  window_start: string | null
  window_end: string | null
  targets: {
    id: string
    server_id: string
    server_snapshot: { name: string; host: string }
    state: string
    preflight_state: string
    preflight_error: unknown
    target_snapshot: PreparedPlan
    result: unknown
  }[]
}
