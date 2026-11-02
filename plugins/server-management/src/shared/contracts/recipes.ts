import type { DefinitionKey, Json, LocalizedText, Revision } from './common.ts'
import type { SoftwareRequirement } from './definitions.ts'
import type { ProbedOs } from '../operating-system-types.ts'
import type { VersionRule } from '../versions.ts'

export interface OsProbeRequest {
  readonly contractVersion: 2
  readonly operation: 'probe-os'
}

export type OsProbeResponse =
  | { readonly state: 'detected'; readonly result: ProbedOs }
  | { readonly state: 'unknown'; readonly code: string; readonly detail?: string }

export interface PackageIdentity {
  readonly manager: string
  readonly name: string
  readonly version: string // 保留 epoch、发行包修订，不作 SemVer 截断
  readonly architecture: string
  readonly source: string // 无凭据的稳定包源身份
  readonly checksum?: string
}

export type SoftwareObservation =
  | {
      readonly state: 'installed'
      readonly version: string
      readonly targetIdentity: string
      readonly packages: readonly PackageIdentity[]
      readonly healthy: boolean
      readonly detail?: string
    }
  | { readonly state: 'missing' }
  | { readonly state: 'unknown'; readonly code: string; readonly detail?: string }

export interface Candidate {
  readonly version: string // 同批软件的统一目标版本
  readonly targetIdentity: string // 产品版本 + 有意义的包修订；不含镜像 URL、时间戳
  readonly packages: readonly PackageIdentity[]
  readonly channel: 'stable' | 'prerelease'
}

export interface ResolvedSoftwareChange {
  readonly software: DefinitionKey
  readonly recipe: DefinitionKey
  readonly recipeRevision: Revision
  readonly action: 'keep' | 'defer-install' | 'install' | 'upgrade' | 'replace'
  readonly before: SoftwareObservation
  readonly target?: Candidate // keep/defer-install 之外必须有精确目标
  readonly dependencies: readonly DefinitionKey[]
  readonly effects: readonly {
    readonly kind: 'service-restart' | 'service-stop' | 'configuration' | 'other'
    readonly description: LocalizedText
  }[]
  readonly payload: Json // 经过配方协议校验的非敏感执行参数
}

/** 脚本通过 stdin 接受 JSON，不把用户输入拼接到 shell 命令。 */
export interface RecipeEnvironment {
  readonly contractVersion: 2
  readonly os: ProbedOs
  readonly software: DefinitionKey
  readonly recipe: DefinitionKey
  readonly recipeRevision: Revision
  readonly effectiveVersions: VersionRule
}

export type RecipeRequest = RecipeEnvironment &
  (
    | { readonly operation: 'detect' }
    | { readonly operation: 'list-candidates'; readonly installed: SoftwareObservation }
    | {
        readonly operation: 'resolve'
        readonly target: Candidate
        readonly installed: SoftwareObservation
        readonly action?: 'install' | 'upgrade' | 'replace'
      }
    | {
        readonly operation: 'execute' | 'verify' | 'recover'
        readonly operationId: string
        readonly planDigest: Revision
        readonly change: ResolvedSoftwareChange
      }
  )

export type RecipeResponse =
  | { readonly operation: 'detect'; readonly result: SoftwareObservation }
  | { readonly operation: 'list-candidates'; readonly candidates: readonly Candidate[] }
  | {
      readonly operation: 'resolve'
      readonly change: ResolvedSoftwareChange
      readonly additionalRequirements: readonly SoftwareRequirement[]
    }
  | {
      readonly operation: 'execute'
      readonly state: 'completed' | 'failed'
      readonly changes: readonly Json[]
      readonly code?: string
      readonly detail?: string
    }
  | {
      readonly operation: 'verify'
      readonly result: SoftwareObservation
      readonly healthy: boolean
      readonly code?: string
      readonly detail?: string
    }
  | {
      readonly operation: 'recover'
      readonly state: 'not-started' | 'running' | 'completed' | 'failed' | 'unknown'
      readonly changes: readonly Json[]
      readonly code?: string
    }
