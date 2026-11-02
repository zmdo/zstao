export interface InsertPlanInput {
  id: string
  kind: string
  snapshot: string
}

export interface InsertTargetInput {
  id: string
  planId: string
  serverId: string
  snapshot: string
  configRevision: string
  environmentRevision: string
}

export interface InsertPreflightJobInput {
  id: string
  serverId: string
  targetId: string | null
  configRevision: string
  environmentRevision: string
  operationId: string
  snapshot: string
}

export interface ReadyPreflightInput {
  targetId: string | null
  snapshot: string
  definitionRevision: string
  environmentRevision: string | number
}

export interface SchedulePlanInput {
  id: string
  snapshot: string
  fingerprint: string
  start: Date
  end: Date
  timezone: string
  concurrency: number
}

export interface InsertApplyJobInput {
  id: string
  serverId: string
  targetId: string | null
  configRevision: string
  environmentRevision: string
  definitionRevision: string
  operationId: string
  snapshot: string
}

export interface CommitBindingInput {
  id: string
  groupId: string | null
  typeKey: string
  snapshot: string
  definitionRevision: string
  installMissing: boolean
  configRevision: string | number | null
}

export interface AdvanceSoftwareRevisionInput {
  id: string
  softwareKeys: string[]
  configRevision: string | number | null
}
