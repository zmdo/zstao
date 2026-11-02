import type { LocalizedText, SoftwareView } from '../definitions.ts'
import type { DeclaredOs, DetectedOs, OsSupport } from '../operating-system-types.ts'
import type { SoftwarePolicy } from '../policies.ts'
import type { DisplayStatus } from '../server-status.ts'

export interface ServerDto {
  id: string
  created_at: string
  software_policies: SoftwarePolicy[]
  upgrade_count: number
  name: string
  host: string
  ssh_port: number
  ssh_user: string
  auth_method: string
  ssh_key_id: string | null
  group_id: string | null
  group_name: string | null
  group_name_i18n: LocalizedText | null
  type_key: string
  type_name_i18n: LocalizedText
  type_available: boolean
  required_software: SoftwareView[]
  software_state: string
  region: string | null
  install_required_software: boolean
  declared_os: DeclaredOs
  detected_os: DetectedOs | null
  os_verification: string
  type_supported_os: OsSupport
  software_status: Record<
    string,
    {
      state?: string
      installed?: boolean
      detail?: string
      version?: string
      last_known_version?: string | null
      revision?: string
    }
  >
  host_fingerprint: string | null
  reachability: string
  status: DisplayStatus
  cpu_model: string | null
  cpu_cores: number | null
  cpu_percent: number | string | null
  resources_fresh: boolean
  mem_total_bytes: number | string | null
  mem_used_bytes: number | string | null
  disk_total_bytes: number | string | null
  disk_used_bytes: number | string | null
  last_checked_at: string | null
}

export interface ServerListItem {
  id: string
  name: string
  upgradeCount: number
  address: { host: string; port: number }
  region: string
  group: { id: string; name: string; name_i18n: LocalizedText | null } | null
  internal_host: string | null
  operatingSystem: { declared: DeclaredOs; label: string; verification: string }
  type: { key: string; name: LocalizedText; available: boolean }
  status: DisplayStatus
  installRequiredSoftware: {
    enabled: boolean
    applicability: 'applicable' | 'not-applicable' | 'unavailable'
  }
  resources: {
    cpuModel: string | null
    cpuCores: number | null
    cpuPercent: number | null
    memoryUsed: string | null
    memoryTotal: string | null
    diskUsed: string | null
    diskTotal: string | null
    sampledAt: string | null
    fresh: boolean
  }
  lastCheckedAt: string | null
}

export interface ServerListPage {
  items: ServerListItem[]
  total: number
  page: number
  page_size: number
  group_id: string | null
  groups: ServerGroupSummary[]
  counts: { all: number; ungrouped: number }
}

export interface ServerGroupSummary {
  id: string
  name: string
  name_i18n: LocalizedText | null
  kind: 'user' | 'system'
  plugin_id: string | null
  available: boolean
  server_count: number
}
