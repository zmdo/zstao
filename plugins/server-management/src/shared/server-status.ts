export const SERVER_STATES = [
  'unverified',
  'normal',
  'disconnected',
  'installing',
  'upgrading',
  'attention',
] as const

export type ServerDisplayStatus = (typeof SERVER_STATES)[number]

export type StatusReasonCode =
  | 'connection_failed'
  | 'connection_unknown'
  | 'connection_stale'
  | 'os_unverified'
  | 'os_mismatch'
  | 'type_unavailable'
  | 'os_unsupported'
  | 'software_missing'
  | 'software_unknown'
  | 'software_unhealthy'
  | 'software_version'
  | 'operation_running'
  | 'operation_recovering'
  | 'operation_expired'

export interface StatusReason {
  code: StatusReasonCode
  parameters: Record<string, string>
}

export interface DisplayStatus {
  code: ServerDisplayStatus
  reasons: StatusReason[]
  jobId: string | null
}
