export type JobPurpose = 'inspect' | 'apply_plan' | 'detect_updates' | 'configure'

export interface JobRequest {
  action: string
  operation?: string
  sequence?: string
  input?: import('../../shared/contracts/common.ts').Json
  source?: 'manual' | 'scheduled'
  prepare?: boolean
  automatic?: boolean
  intervalSeconds?: number
  planId?: string
  digest?: string
}

export const LEASE_SECONDS = 60
