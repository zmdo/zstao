import type { ChangeRequest, PreparedPlan } from '../../../shared/changes.ts'
import type { DeclaredOs } from '../../../shared/operating-system-types.ts'

export interface PlanRow {
  id: string
  kind: 'prepare' | 'move' | 'upgrade'
  state: string
  revision: string
  request_snapshot: ChangeRequest
  confirmation_digest: string | null
  window_start: Date | null
  window_end: Date | null
  concurrency: number
}

export interface PlanSummaryRow extends PlanRow {
  created_at: Date
  target_count: number
  succeeded_count: number
  running_count: number
}

export type PlanServerRow = {
  id: string
  config_revision: string
  environment_revision: string
  name: string
  host: string
  declared_os: DeclaredOs
}

export type ChangeTargetRow = {
  id: string
  server_id: string
  server_snapshot: unknown
  expected_config_revision: string
  expected_environment_revision: string
  definition_revision: string
  target_snapshot: PreparedPlan
  state: string
  preflight_state: string
  preflight_error: unknown
  result: unknown
}

export type ServerRevisionsRow = { config_revision: string; environment_revision: string }
