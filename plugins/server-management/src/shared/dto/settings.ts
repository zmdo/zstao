export interface ExecLimitsSettings {
  defaultTimeoutMs: number
  maxTimeoutMs: number
  defaultCommandBytes: number
  maxCommandBytes: number
  defaultOutputBytes: number
  maxOutputBytes: number
  rsyncDeniedFlags: string[]
  updated_at: string | null
}
