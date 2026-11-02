import type { VersionRule } from './versions.ts'
export interface SoftwarePolicy {
  software_key: string
  restriction: VersionRule
  detect_updates: boolean
}
