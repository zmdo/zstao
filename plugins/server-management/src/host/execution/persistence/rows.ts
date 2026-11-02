import type { JobPurpose, JobRequest } from '../model.ts'
import type { PreparedPlan } from '../../../shared/changes.ts'
import type { ChangeRequest } from '../../../shared/changes.ts'

export interface JobRecord {
  id: string
  server_id: string
  server_identity: string
  purpose: JobPurpose
  state: string
  phase: string
  mutation_phase: string | null
  expected_config_revision: string
  expected_environment_revision: string
  definition_revision: string
  target_id: string | null
  operation_id: string
  worker_id: string
  fence: string
  lease_expires_at: Date
  request_snapshot: JobRequest
  result: unknown
  output_excerpt: string
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
  recovery_attempts: number
}

export type LockServerRevisionRow = { config_revision: string; environment_revision: string }

export type PlanAdmissionRow = {
  id: string
  state: string
  concurrency: number
  window_start: Date
  window_end: Date
}

export type TargetSnapshotRow = { target_snapshot: PreparedPlan }

export type ServerRevisionRow = { config_revision: string }

export type AcceptedPlanRow = {
  target_snapshot: PreparedPlan
  confirmation_digest: string
  state: string
  window_start: Date
  window_end: Date
  request_snapshot: ChangeRequest & { plan?: PreparedPlan }
}
