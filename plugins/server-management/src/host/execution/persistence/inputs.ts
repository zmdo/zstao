export interface MatchingInspectionInput {
  serverId: string
  configRevision: string | number
  snapshot: string
}

export interface InsertInspectionInput {
  id: string
  serverId: string
  configRevision: string | number
  environmentRevision: string
  definitionRevision: string
  operationId: string
  snapshot: string
}

export interface ClaimInput {
  id: string
  state: string
  workerId: string
  leaseSeconds: number
}

export interface HeartbeatInput {
  id: string
  workerId: string
  fence: string
  leaseSeconds: number
}

export interface LockOwnershipInput {
  id: string
  workerId: string
  fence: string
}

export interface FinishInput {
  id: string
  state: string
  message: string
  result: string
}

export interface FailDetectionInput {
  serverId: string
  result: string
  intervalSeconds: number
}

export interface FailBindingInput {
  id: string
  state: string
  result: string
  message: string
}

export interface FinishTargetInput {
  targetId: string | null
  state: string
  result: string
}

export interface RecoveringInput {
  id: string
  message: string
  remoteState: 'running' | 'unknown'
}

export interface InsertPreparationInput {
  id: string
  fingerprint: string
  authorization: string
  start: string
  end: string
  snapshot: string
}

export interface InsertPreparedTargetInput {
  id: string
  planId: string
  serverId: string
  snapshot: string
  configRevision: string | number
  environmentRevision: string | number
  definitionRevision: string
  plan: string
}

export interface InsertApplyJobInput {
  id: string
  serverId: string
  targetId: string | null
  configRevision: string | number
  environmentRevision: string | number
  definitionRevision: string
  operationId: string
  snapshot: string
}

export interface AcceptedPlanInput {
  targetId: string | null
  serverId: string
  configRevision: string | number
  definitionRevision: string
}

export interface SaveStepInput {
  id: string
  jobId: string
  ordinal: number
  software: string
  state: string
  after: string
  changes: string
  error: string | null
  phase: string
}
