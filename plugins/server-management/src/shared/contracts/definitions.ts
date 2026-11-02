import type { DefinitionKey, LocalizedText } from './common.ts'
import type { OsSelector, OsSupport } from '../operating-system-types.ts'
import type { ServerExtensionBundle } from './extensions.ts'
import type { VersionAdapter, VersionRule } from '../versions.ts'

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
  readonly defaultTypeByOs?: readonly {
    readonly whenOs: readonly OsSelector[]
    readonly type: DefinitionKey
  }[]
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

export interface PublicTypeContribution {
  /** Full key of a type declared by this bundle. */
  readonly type: DefinitionKey
  /** Public catalog order; equal orders are sorted by stable key. */
  readonly order?: number
}

export interface DefinitionBundle {
  readonly contractVersion: 2
  readonly owner: string // 插件包名；宿主按贡献者上下文核对归属
  readonly operatingSystems?: readonly OsFamilyDefinition[]
  readonly software?: readonly SoftwareDefinition[]
  readonly recipes?: readonly RecipeDefinition[]
  readonly types?: readonly ServerTypeDefinition[]
  readonly publicTypes?: readonly PublicTypeContribution[]
  readonly groups?: readonly SystemGroupDefinition[]
}

export interface Registration {
  readonly ready: Promise<void>
  dispose(): Promise<void>
}

export interface ServerManagementContract {
  /** 整包原子注册；effect 属于调用插件；卸载自动调用并等待 dispose。 */
  registerDefinitions(definition: DefinitionBundle): Registration
  registerServerExtensions(extensions: ServerExtensionBundle): Registration
}
