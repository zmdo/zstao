import type { LocalizedText } from '../../shared/contracts/common.ts'
import type { RecipeDefinition } from '../../shared/contracts/definitions.ts'
import { ServerError } from '../../shared/errors.ts'
import type { OsSelector } from '../../shared/operating-systems.ts'
import { APT_SOFTWARE_OS } from '../../shared/operating-systems.ts'
import { stableVersions, type VersionAdapter, type VersionRule } from '../../shared/versions.ts'
import { digest } from '../recipes/canonical.ts'
import { type LoadedScript } from '../recipes/script.ts'

export interface Component {
  id: string
  software_key: string
  name: string
  summary: string
  name_i18n: LocalizedText
  summary_i18n: LocalizedText
  supportedOs: readonly OsSelector[]
  whenOs?: readonly OsSelector[]
  requires: string[]
  recipe: string
  revision: string
  versions: VersionRule
  adapter: VersionAdapter
  scripts: {
    detect: LoadedScript
    listCandidates?: LoadedScript
    resolve?: LoadedScript
    execute?: LoadedScript
    verify?: LoadedScript
    recover?: LoadedScript
  }
  actions: readonly ('install' | 'upgrade' | 'replace')[]
}
export function componentRevision(component: Component): string {
  return component.revision
}
export class CatalogError extends ServerError {}
export function builtinCatalog(): Component[] {
  return []
}
export function normalizeSelection(catalog: readonly Component[], ids: readonly string[]): string[] {
  const selected = new Set(ids)
  for (const id of selected) {
    const item = catalog.find((c) => c.id === id)
    if (!item) throw new CatalogError('component_unknown')
    for (const dependency of item.requires)
      if (!selected.has(dependency))
        throw new CatalogError('component_dependency', { component: id, dependency })
  }
  return catalog.filter((item) => selected.has(item.id)).map((item) => item.id)
}
export type LoadedRecipe = Omit<RecipeDefinition, 'detect' | 'listCandidates' | 'resolve' | 'mutation'> & {
  revision: string
  scripts: Component['scripts']
  actions: Component['actions']
}

export function componentView(
  catalog: readonly Component[],
): { id: string; name: string; summary: string; requires: string[] }[] {
  return catalog.map((item) => ({
    id: item.id,
    name: item.name,
    summary: item.summary,
    requires: item.requires,
  }))
}
