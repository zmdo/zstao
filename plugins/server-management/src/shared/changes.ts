import type { ResolvedSoftwareChange } from './contracts/recipes.ts'
import type { DetectedOs } from './operating-system-types.ts'
import type { SoftwarePolicy } from './policies.ts'
export interface PreparedPlan {
  definitionRevision: string
  os: DetectedOs
  changes: ResolvedSoftwareChange[]
  risks?: { major: boolean; replacement: boolean; serviceImpact: boolean }
  targetType?: import('./definitions.ts').ServerTypeView
}
export interface ChangeSelection {
  serverIds: string[]
  versions: Record<string, string>
  binding?: { groupId: string | null; typeKey: string; installMissing: boolean; policies: SoftwarePolicy[] }
}
export interface ChangeRequest {
  selection: ChangeSelection
  targets?: {
    id: string
    serverId: string
    configRevision: string
    environmentRevision: string
    definitionRevision: string
    plan: PreparedPlan
  }[]
  execution?: { start: string; end: string; timezone: string; concurrency: number }
  acknowledgments?: { replacement: boolean; major: boolean; serviceImpact: boolean }
}
