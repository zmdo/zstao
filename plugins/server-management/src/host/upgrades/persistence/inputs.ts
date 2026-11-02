export interface SaveCheckInput {
  serverId: string
  software: string
  intervalSeconds: number
  snapshot: string
  error: string | null
}

export interface UpsertSuggestionInput {
  id: string
  serverId: string
  software: string
  targetIdentity: string
  version: string
  candidate: string
  basis: string
  reason: string
}

export interface SatisfySuggestionInput {
  serverId: string
  software: string
  targetIdentity: string
}

export interface InsertDetectionInput {
  id: string
  serverId: string
  configRevision: string | number
  environmentRevision: string
  operationId: string
  snapshot: string
}

export interface SetReminderInput {
  serverId: string
  softwareKey: string
  until: Date | null
}
