import type { LocalizedText, TypeOptions } from '../../../shared/definitions.ts'
import type { DeclaredOs, DetectedOs } from '../../../shared/operating-systems.ts'

export interface GroupRow {
  id: string
  name: string
  kind: 'user' | 'system'
  plugin_id: string | null
  group_key: string | null
  name_i18n: LocalizedText | null
  sort_order: number
  definition: Partial<TypeOptions>
  server_count?: number
}

export type LockGroupRow = { kind: string }

export type GroupMemberRow = {
  id: string
  type_key: string
  declared_os: DeclaredOs
  detected_os: DetectedOs | null
  os_probe_state: string
  config_revision: string
  observed_config_revision: string
}
