/**
 * 服务器管理 V2 契约设计稿。不是当前插件导出；不得从业务代码导入。
 * 生命周期、验证边界及持久化规则见 data-model.md。
 */
export type LocalizedText = Readonly<{ zh: string; en: string }>
export type DefinitionKey = string // builtin/<key> 或 <插件包名>/<局部键>
export type Revision = string // 宿主计算的内容摘要，不能由页面或插件自报代替
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

export type VersionRule =
  | { readonly kind: 'any' }
  | { readonly kind: 'exact'; readonly version: string }
  | { readonly kind: 'series'; readonly prefix: string }
  | { readonly kind: 'minimum'; readonly version: string }
  | { readonly kind: 'range'; readonly minimum: string; readonly maximum: string }

/** 软件版本与包版本分开；非 SemVer 软件须提供完整的范围运算能力。 */
export interface VersionAdapter {
  readonly revision: string
  normalize(version: string): string
  compare(left: string, right: string): -1 | 0 | 1
  validate(rule: VersionRule): void
  contains(rule: VersionRule, version: string): boolean
  isSubset(narrower: VersionRule, wider: VersionRule): boolean
  intersect(rules: readonly VersionRule[]): VersionRule | null
  isSingleton(rule: VersionRule): boolean
  atInclusiveUpperBound(rule: VersionRule, version: string): boolean
  isMajorChange(from: string, to: string): boolean
}

/** 操作系统版本单独比较；Ubuntu 年月、Windows 年份不是软件 SemVer。 */
export type OsVersionRule =
  | { readonly kind: 'any' }
  | { readonly kind: 'release'; readonly version: string }
  | { readonly kind: 'series'; readonly prefix: string }
  | { readonly kind: 'range'; readonly minimum: string; readonly maximum: string }

export interface OsSelector {
  readonly family: DefinitionKey
  readonly versions: OsVersionRule
  readonly architectures?: readonly string[] // 未知架构在执行前仍须探测
}

export type OsSupport =
  | { readonly kind: 'all' } // 仅无软件要求的类型可用；不是配方兼容声明
  | { readonly kind: 'explicit'; readonly selectors: readonly OsSelector[] }

export interface OsFamilyDefinition {
  readonly key: string
  readonly name: LocalizedText
  readonly versionOrder:
    | { readonly kind: 'numeric-dotted' }
    | { readonly kind: 'ordered-releases'; readonly versions: readonly string[] }
  readonly releases: readonly {
    readonly key: string
    readonly version: string
    readonly precision: 'release' | 'series'
    readonly name: LocalizedText
  }[]
  /** “其他”只允许精确别名映射，保留原文；不靠正则／模糊匹配授权安装。 */
  readonly aliases?: readonly { readonly input: string; readonly releaseKey: string }[]
  readonly probe?: ScriptDefinition // 只读；新增系统的实际识别必须可验证
}

export type DeclaredOs =
  | { readonly kind: 'catalog'; readonly family: DefinitionKey; readonly releaseKey: string; readonly version: string; readonly precision: 'release' | 'series' }
  | { readonly kind: 'custom'; readonly text: string; readonly resolved?: { readonly family: DefinitionKey; readonly releaseKey: string; readonly version: string; readonly precision: 'release' | 'series' } }

export interface DetectedOs {
  readonly family: DefinitionKey
  readonly version: string
  readonly architecture: string
  readonly raw: Readonly<Record<string, string>>
}

export interface OsProbeRequest {
  readonly contractVersion: 2
  readonly operation: 'probe-os'
}

export type OsProbeResponse =
  | { readonly state: 'detected'; readonly result: DetectedOs }
  | { readonly state: 'unknown'; readonly code: string; readonly detail?: string }

export interface SoftwareDefinition {
  readonly key: string
  readonly name: LocalizedText
  readonly versions: 'semver-stable' | VersionAdapter
}

export interface SoftwareRequirement {
  readonly software: DefinitionKey
  readonly versions: VersionRule
  readonly recipes: readonly DefinitionKey[] // 保留仍适用的当前配方，否则按此优先序选择
  readonly whenOs?: readonly OsSelector[] // 省略表示在类型支持的系统中始终必要
}

export interface ServerTypeDefinition {
  readonly key: string
  readonly name: LocalizedText
  readonly supportedOs: OsSupport
  readonly requirements: readonly SoftwareRequirement[]
}

export interface SystemGroupDefinition {
  readonly key: string
  readonly name: LocalizedText
  readonly order?: number
  /** 省略继承内置两类；显式提供时完整替换，不得为空。 */
  readonly types?: readonly DefinitionKey[]
  readonly defaultType?: DefinitionKey
  readonly defaultTypeByOs?: readonly { readonly whenOs: readonly OsSelector[]; readonly type: DefinitionKey }[]
}

export interface ScriptDefinition {
  readonly path: string // 插件内绝对路径，注册时读取并计算摘要；页面不可提供
  readonly interpreter: 'posix-sh' | 'powershell'
  readonly timeoutMs: number
  readonly outputLimitBytes: number
}

export interface RecipeDefinition {
  readonly key: string
  readonly software: DefinitionKey
  readonly supportedOs: readonly OsSelector[]
  readonly requires?: readonly SoftwareRequirement[]
  readonly detect: ScriptDefinition
  readonly listCandidates?: ScriptDefinition
  readonly resolve?: ScriptDefinition
  readonly mutation?: {
    readonly actions: readonly ('install' | 'upgrade' | 'replace')[]
    readonly execute: ScriptDefinition
    readonly verify: ScriptDefinition
    readonly recover: ScriptDefinition
  }
}

export interface DefinitionBundle {
  readonly contractVersion: 2
  readonly owner: string // 插件包名；宿主按贡献者上下文核对归属
  readonly operatingSystems?: readonly OsFamilyDefinition[]
  readonly software?: readonly SoftwareDefinition[]
  readonly recipes?: readonly RecipeDefinition[]
  readonly types?: readonly ServerTypeDefinition[]
  readonly groups?: readonly SystemGroupDefinition[]
}

export interface Registration {
  readonly ready: Promise<void>
  dispose(): Promise<void>
}

export interface ServerManagementContract {
  /** 整包原子注册；effect 属于调用插件；卸载自动调用并等待 dispose。 */
  registerDefinitions(definition: DefinitionBundle): Registration
}

export interface PackageIdentity {
  readonly manager: string
  readonly name: string
  readonly version: string // 保留 epoch、发行包修订，不作 SemVer 截断
  readonly architecture: string
  readonly source: string // 无凭据的稳定包源身份
  readonly checksum?: string
}

export type SoftwareObservation =
  | { readonly state: 'installed'; readonly version: string; readonly targetIdentity: string; readonly packages: readonly PackageIdentity[]; readonly healthy: boolean; readonly detail?: string }
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
  readonly os: DetectedOs
  readonly software: DefinitionKey
  readonly effectiveVersions: VersionRule
}

export type RecipeRequest = RecipeEnvironment & (
  | { readonly operation: 'detect' }
  | { readonly operation: 'list-candidates'; readonly installed: SoftwareObservation }
  | { readonly operation: 'resolve'; readonly target: Candidate; readonly installed: SoftwareObservation; readonly action?: 'install' | 'upgrade' | 'replace' }
  | { readonly operation: 'execute' | 'verify' | 'recover'; readonly operationId: string; readonly planDigest: Revision; readonly change: ResolvedSoftwareChange }
)

export type RecipeResponse =
  | { readonly operation: 'detect'; readonly result: SoftwareObservation }
  | { readonly operation: 'list-candidates'; readonly candidates: readonly Candidate[] }
  | { readonly operation: 'resolve'; readonly change: ResolvedSoftwareChange; readonly additionalRequirements: readonly SoftwareRequirement[] }
  | { readonly operation: 'execute'; readonly state: 'completed' | 'failed'; readonly changes: readonly Json[]; readonly code?: string }
  | { readonly operation: 'verify'; readonly result: SoftwareObservation; readonly healthy: boolean; readonly code?: string }
  | { readonly operation: 'recover'; readonly state: 'not-started' | 'running' | 'completed' | 'failed' | 'unknown'; readonly changes: readonly Json[]; readonly code?: string }

export interface ServerSoftwarePolicy {
  readonly software: DefinitionKey
  readonly restriction: VersionRule
  readonly detectUpdates: boolean // 默认 false；从不授权安装／升级
}

export interface PlanTargetSnapshot {
  readonly serverId: string
  readonly expectedConfigRevision: string // bigint 在 JSON 中用字符串，避免精度损失
  readonly expectedEnvironmentRevision: string
  readonly definitionRevision: Revision
  readonly source: { readonly groupId: string | null; readonly type: DefinitionKey }
  readonly desired: { readonly groupId: string | null; readonly type: DefinitionKey; readonly installRequiredSoftware: boolean; readonly policies: readonly ServerSoftwarePolicy[] }
  readonly declaredOs: DeclaredOs
  readonly detectedOs: DetectedOs | null
  readonly software: readonly ResolvedSoftwareChange[] // 按依赖拓扑排序，不能有未解析的 latest
}

export interface PlanConfirmation {
  readonly planId: string
  readonly digest: Revision
  readonly expectedRevision: string
  readonly acknowledgeMajorChanges: boolean
  readonly acknowledgeServiceImpact: boolean
  readonly window: { readonly start: string; readonly end: string; readonly timezone: string }
}

export interface ServerListQuery {
  readonly groupId?: string | null
  readonly search?: string
  readonly status?: ServerDisplayStatus
  readonly upgrades?: 'actionable' | 'deferred' | 'rejected' | 'scheduled' | 'check-failed'
  readonly page: number
  readonly pageSize: 10 | 20 | 50
  readonly order: 'name' | 'last-checked'
}

export type ServerDisplayStatus = 'unverified' | 'normal' | 'disconnected' | 'installing' | 'upgrading' | 'attention'

export interface ServerListItem {
  readonly id: string
  readonly name: string
  readonly address: { readonly host: string; readonly port: number }
  readonly operatingSystem: { readonly declared: DeclaredOs; readonly label: string; readonly verification: 'unverified' | 'matched' | 'mismatch'; readonly checkedAt: string | null }
  readonly type: { readonly key: DefinitionKey; readonly name: LocalizedText; readonly available: boolean }
  readonly status: { readonly code: ServerDisplayStatus; readonly reasons: readonly { readonly code: string; readonly parameters: Readonly<Record<string, string>> }[]; readonly jobId: string | null }
  readonly installRequiredSoftware: { readonly enabled: boolean; readonly applicability: 'applicable' | 'not-applicable' | 'unavailable' }
  readonly resources: { readonly cpuPercent: number | null; readonly memoryUsed: string | null; readonly memoryTotal: string | null; readonly diskUsed: string | null; readonly diskTotal: string | null; readonly sampledAt: string | null }
  readonly lastCheckedAt: string | null
  readonly configRevision: string
}
