import type { Candidate, SoftwareObservation } from '../../../shared/contracts/recipes.ts'
import type { LocalizedText, SoftwareView } from '../../../shared/definitions.ts'
import type { DeclaredOs, DetectedOs } from '../../../shared/operating-systems.ts'
import type { JobRecord } from '../../execution/persistence/rows.ts'
import type { UpdateCheck } from '../model.ts'

export interface InventoryRow {
  id: string
  name: string
  group_id: string | null
  type_key: string
  type_name_i18n: LocalizedText
  required_software: SoftwareView[]
}

export interface SuggestionRow {
  id: string
  server_id: string
  software_key: string
  target_identity: string
  product_version: string
  candidate_snapshot: Candidate
  basis_snapshot: {
    configRevision: string
    environmentRevision: string
    definitionRevision: string
    before: Extract<SoftwareObservation, { state: 'installed' }>
  }
  validity: string
  reason: { major: boolean; code?: string }
  decision: string
  decision_at: Date | null
  first_seen_at: Date
  last_seen_at: Date
  server_name: string
  host: string
  group_id: string | null
  type_key: string
  connection_state: string
  reminder_after: Date | null
  check_error: unknown
  last_check_at: Date | null
  group_name: string | null
  scheduled: boolean
}

export interface DetectionRow {
  server_id: string
  software_key: string
  last_check_at: Date | null
  check_error: unknown
  check_snapshot:
    | (UpdateCheck & {
        basis: { configRevision: string; environmentRevision: string; definitionRevision: string }
      })
    | null
  server_name: string
  host: string
  group_id: string | null
  type_key: string
  connection_state: string
}

export interface ExecutionRecordRow {
  id: string
  server_identity: string
  state: string
  phase: string
  request_snapshot: JobRecord['request_snapshot']
  result: unknown
  output_excerpt: string
  created_at: Date
  finished_at: Date | null
  server_snapshot: { name: string; host: string }
  plan_id: string
  steps: unknown[]
}

export type LockServerRevisionRow = { config_revision: string; environment_revision: string }

export type SuggestionIdentityRow = { server_id: string; software_key: string }

export type VersionCheckRow = {
  server_id: string
  check_snapshot: {
    eligible: { version: string }[]
    basis: { configRevision: string; environmentRevision: string; definitionRevision: string }
  } | null
  config_revision: string
  environment_revision: string
}

export type ServerSignatureRow = {
  id: string
  group_id: string | null
  type_key: string
  declared_os: DeclaredOs
  detected_os: DetectedOs | null
}
