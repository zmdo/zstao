import type { SoftwareDefinition } from '../../shared/contracts/definitions.ts'
import {
  VACANT_TYPE,
  type ServerTypeView,
  type SoftwareView,
} from '../../shared/definitions.ts'
import { APT_SOFTWARE_OS } from '../../shared/operating-systems.ts'
import { stableVersions, type VersionAdapter } from '../../shared/versions.ts'
import { digest } from '../recipes/canonical.ts'
import { CatalogError, componentRevision, type Component } from './catalog.ts'

export function softwareView(item: Component): SoftwareView {
  return {
    id: item.id,
    software_key: item.software_key,
    supportedOs: item.supportedOs,
    whenOs: item.whenOs,
    name: item.name,
    summary: item.summary,
    name_i18n: item.name_i18n,
    summary_i18n: item.summary_i18n,
    requires: [...item.requires],
    recipe: item.recipe,
    revision: componentRevision(item),
    versions: item.versions,
  }
}

export function requiredSoftware(catalog: readonly Component[], ids: readonly string[]): Component[] {
  const byId = new Map(catalog.map((item) => [item.id, item])),
    visiting = new Set<string>(),
    visited = new Set<string>(),
    result: Component[] = []
  const visit = (id: string) => {
    if (visited.has(id)) return
    const item = byId.get(id)
    if (!item) throw new CatalogError('component_unknown', { component: id })
    if (visiting.has(id)) throw new CatalogError('component_cycle', { component: id })
    visiting.add(id)
    for (const dep of item.requires) visit(dep)
    visiting.delete(id)
    visited.add(id)
    result.push(item)
  }
  for (const id of ids) visit(id)
  return result
}

export function builtinTypes(catalog: readonly Component[]): readonly ServerTypeView[] {
  return [
    {
      key: VACANT_TYPE,
      name_i18n: { zh: '空置服务器', en: 'Vacant server' },
      software: [],
      supportedOs: { kind: 'all' },
    },
  ]
}

export function adapterOf(software: SoftwareDefinition): VersionAdapter {
  return software.versions === 'semver-stable' ? stableVersions : software.versions
}

export function definitionSignature(type: ServerTypeView, components: readonly Component[]): string {
  return digest({
    key: type.key,
    supportedOs: type.supportedOs,
    software: components.map((c) => ({ software: c.software_key, revision: c.revision })),
  })
}
