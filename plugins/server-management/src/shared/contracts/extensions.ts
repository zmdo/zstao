import type { DefinitionKey, LocalizedText } from './common.ts'
import type { ScriptDefinition } from './definitions.ts'
import type { OsSupport } from '../operating-system-types.ts'

/** Declarative applicability. Omitted types mean every server; omitted OS means every system. */
export interface ExtensionScope {
  readonly types?: readonly DefinitionKey[]
  readonly os?: OsSupport
}

export interface ExtensionPanel {
  readonly key: string
  readonly name: LocalizedText
  readonly order?: number
  readonly appliesTo?: ExtensionScope
}

export interface ExtensionSettingsSection {
  /** Bump whenever validation, defaults or execution semantics change. Stable across restarts. */
  readonly revision: string
  readonly key: string
  readonly name: LocalizedText
  readonly order?: number
  readonly appliesTo?: ExtensionScope
  /** Sensitive fields are not storable until an encrypted settings capability exists. */
  readonly sensitive?: boolean
  /** Execution-affecting settings need the plan binding/recheck flow; generic saves are rejected. */
  readonly affectsExecution?: boolean
}

export interface ExtensionQuery {
  readonly key: string
  readonly name: LocalizedText
  readonly order?: number
  readonly appliesTo?: ExtensionScope
}

export interface ExtensionInspection {
  readonly key: string
  readonly name: LocalizedText
  readonly order?: number
  readonly appliesTo?: ExtensionScope
  /** Read-only script snapshot; the core executor owns SSH and the task fence. */
  readonly script: ScriptDefinition
  /** Optional settings section that can disable this inspection. */
  readonly settingsKey?: DefinitionKey
}

/**
 * Metadata only. Components are registered through the public client slots in a later step.
 * Register extensions after the type definitions they reference are ready.
 */
export interface ServerExtensionBundle {
  readonly contractVersion: 1
  readonly owner: string
  readonly panels?: readonly ExtensionPanel[]
  readonly settings?: readonly ExtensionSettingsSection[]
  readonly queries?: readonly ExtensionQuery[]
  readonly inspections?: readonly ExtensionInspection[]
}

export type ExtensionKind = 'panel' | 'settings' | 'query' | 'inspection'

export interface ExtensionCatalogEntry {
  readonly key: string // owner/local-key
  readonly owner: string
  readonly kind: ExtensionKind
  readonly name: LocalizedText
  readonly order: number
  readonly appliesTo: ExtensionScope
  readonly affectsExecution?: boolean
  readonly settingsRevision?: string
  readonly settingsKey?: DefinitionKey
}
