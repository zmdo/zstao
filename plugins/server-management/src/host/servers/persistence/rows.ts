import type { ServerTypeView } from '../../../shared/definitions.ts'
import type { DeclaredOs, DetectedOs } from '../../../shared/operating-systems.ts'
import type { SoftwarePolicy } from '../../../shared/policies.ts'

export interface EditableServer {
  id: string
  host: string
  ssh_port: number
  ssh_user: string
  auth_method: string
  ssh_key_id: string | null
  install_required_software: boolean
  declared_os: DeclaredOs
  group_id: string | null
  type_key: string
  type_snapshot: ServerTypeView | null
  type_revision: string
  config_revision: string | number
}

export interface ServerFact {
  id: string
  name: string
  host: string
  ssh_port: number
  ssh_user: string
  auth_method: string
  ssh_key_id: string | null
  group_id: string | null
  region: string
  internal_host: string | null
  install_required_software: boolean
  type_key: string
  type_snapshot: ServerTypeView
  type_revision: string
  config_revision: string
  declared_os: DeclaredOs
  host_fingerprint: string | null
  created_at: Date
  reachability: string
  connection_error: { message?: string } | null
  last_checked_at: Date | null
  detected_os: DetectedOs | null
  os_probe_state: string
  observed_config_revision: string
  environment_revision: string
  os_checked_at: Date | null
  os_error: unknown
  cpu_model: string | null
  cpu_cores: number | null
  cpu_percent: number | string | null
  mem_total_bytes: string | null
  mem_used_bytes: string | null
  disk_total_bytes: string | null
  disk_used_bytes: string | null
  metrics_at: Date | null
}

export interface SoftwareFact {
  server_id: string
  software_key: string
  probe_state: string
  checked_at: Date
  recipe_key: string
  recipe_revision: string
  observed_config_revision: string
  observed_environment_revision: string
  product_version: string | null
  healthy: boolean | null
  error: { detail?: string } | null
}

export interface ActiveOperation {
  id: string
  server_id: string
  state: string
  phase: string
  mutation_phase: string | null
  lease_expires_at: Date | null
  result: { remote_state?: string; remote_checked_at?: string } | null
}

export interface ServerSecret {
  id: string
  host: string
  ssh_port: number
  ssh_user: string
  auth_method: string
  secret_ciphertext: string
  host_fingerprint: string | null
  install_required_software: boolean
  declared_os: DeclaredOs
  detected_os: DetectedOs | null
  os_probe_state: string
  observed_config_revision: string | number
  environment_revision: string | number
  group_id: string | null
  type_key: string
  config_revision: string | number
  internal_host: string | null
}


export interface SoftwarePolicyRecord extends SoftwarePolicy {
  server_id: string
  policy_revision: string
  reminder_after: Date | null
  last_check_at: Date | null
  next_check_at: Date | null
  check_snapshot: unknown
  check_error: unknown
  updated_at: Date
}

export type SnapshotTimeRow = { now: Date }

export type ServerCountsRow = { all: number; ungrouped: number }

export type ServerPolicyRow = SoftwarePolicy & { server_id: string }

export type UpgradeCountsRow = { server_id: string; count: number; definition: string }

export type ContainerScanRow = { state: string; last_success_at: Date | null }

export type ServerBindingRow = Pick<
  EditableServer,
  'id' | 'group_id' | 'type_key' | 'config_revision' | 'declared_os'
>
