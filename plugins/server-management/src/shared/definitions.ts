import type { LocalizedText } from './contracts/common.ts'
import type { OsSelector, OsSupport } from './operating-systems.ts'
import { supportsOs, type DeclaredOs, type DetectedOs } from './operating-systems.ts'
export type { LocalizedText } from './contracts/common.ts'

export type {
  DefinitionBundle,
  ServerTypeDefinition,
  SoftwareDefinition,
  SystemGroupDefinition,
} from './contracts/definitions.ts'

export interface SoftwareView {
  id: string
  software_key: string
  supportedOs: readonly OsSelector[]
  whenOs?: readonly OsSelector[]
  name: string
  summary: string
  name_i18n: LocalizedText
  summary_i18n: LocalizedText
  requires: readonly string[]
  recipe: string
  revision: string
  versions?: import('./versions.ts').VersionRule
}

export interface ServerTypeView {
  key: string
  name_i18n: LocalizedText
  software: readonly SoftwareView[]
  supportedOs: OsSupport
}

export interface TypeOptions {
  kind: 'user' | 'system'
  available: boolean
  default_type_key: string
  default_type_by_os?: readonly {
    whenOs: readonly OsSelector[]
    type: string
  }[]
  types: readonly ServerTypeView[]
}

export const VACANT_TYPE = 'builtin/vacant'

export function sameSoftware(left: ServerTypeView, right: ServerTypeView): boolean {
  const signature = (type: ServerTypeView) =>
    type.software
      .map((item) => `${item.id}\0${item.recipe}\0${item.revision}`)
      .sort()
      .join('\n')
  return signature(left) === signature(right)
}

export function typeSupportsOs(type: ServerTypeView, os: DeclaredOs | DetectedOs): boolean {
  return (
    supportsOs(type.supportedOs, os) &&
    type.software
      .filter((item) => !item.whenOs || supportsOs({ kind: 'explicit', selectors: item.whenOs }, os))
      .every((item) => supportsOs({ kind: 'explicit', selectors: item.supportedOs }, os))
  )
}

export function defaultTypeForOs(
  options: TypeOptions | undefined,
  os: DeclaredOs | undefined,
): string | undefined {
  return (
    (os &&
      options?.default_type_by_os?.find((rule) =>
        supportsOs({ kind: 'explicit', selectors: rule.whenOs }, os),
      )?.type) ||
    options?.default_type_key
  )
}
