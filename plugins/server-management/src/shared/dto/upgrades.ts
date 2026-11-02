import type { LocalizedText, SoftwareView } from '../definitions.ts'

export interface Suggestion {
  id: string
  server_id: string
  server_name: string
  host: string
  software_key: string
  product_version: string
  group_id: string | null
  type_key: string
  connection_state: string
  decision: string
  reminder_after: string | null
  scheduled: boolean
  basis_snapshot: { before: { version: string } }
  reason: { major: boolean; code?: string }
  validity: string
}

export interface Suggestions {
  items: Suggestion[]
  total: number
  page: number
  page_size: number
  filtered_server_ids: string[]
  checks: DetectionResult[]
}

export interface Inventory {
  type_name_i18n: LocalizedText
  required_software: SoftwareView[]
  id: string
  name: string
  group_id: string | null
  type_key: string
}

export interface RecordPage {
  page: number
  page_size: number
  items: {
    id: string
    state: string
    plan_id: string
    server_snapshot: { name: string }
    created_at: string
    finished_at: string | null
    output_excerpt: string
    result: unknown
    steps: unknown[]
  }[]
  total: number
}

export interface DetectionResult {
  server_id: string
  server_name: string
  host?: string
  software_key: string
  last_check_at: string | null
  check_error: unknown
  check_snapshot?: {
    reason: string | null
    eligible?: readonly unknown[]
    before?: { state: string; detail?: string }
  } | null
}
