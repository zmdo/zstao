import { type LocalizedText } from '../../shared/contracts/common.ts'
import type {
  ServerTypeDefinition,
  SoftwareDefinition,
  SoftwareRequirement,
  SystemGroupDefinition,
} from '../../shared/contracts/definitions.ts'
import { VACANT_TYPE, type ServerTypeView, type TypeOptions } from '../../shared/definitions.ts'
import { ServerError } from '../../shared/errors.ts'
import { supportsOs, type DeclaredOs, type DetectedOs } from '../../shared/operating-systems.ts'
import { type VersionAdapter, type VersionRule } from '../../shared/versions.ts'
import { digest } from '../recipes/canonical.ts'
import { CatalogError, type Component, type LoadedRecipe } from './catalog.ts'
import type { Owner } from './model.ts'
import { adapterOf, builtinTypes, requiredSoftware, softwareView } from './views.ts'

export class DefinitionResolver {
  private readonly base: readonly Component[]
  private readonly owners: Map<string, Owner>
  constructor(base: readonly Component[], owners: Map<string, Owner>) {
    this.base = base
    this.owners = owners
  }
  isAvailable(owner: Owner, seen = new Set<Owner>()): boolean {
    if (seen.has(owner)) return true
    seen.add(owner)
    return owner.active && [...owner.dependencies].every((dep) => this.isAvailable(dep, seen))
  }
  find<T>(
    key: string,
    map: 'software' | 'recipes' | 'types',
    requester: Owner | undefined,
    owners: Map<string, Owner>,
  ): T {
    for (const owner of owners.values()) {
      const value = owner[map].get(key)
      if (value !== undefined && this.isAvailable(owner)) {
        if (requester && requester !== owner) requester.dependencies.add(owner)
        return value as T
      }
    }
    throw new ServerError('definition_reference', { detail: key })
  }
  software(
    key: string,
    requester: Owner | undefined,
    owners: Map<string, Owner>,
  ): { name: LocalizedText; adapter: VersionAdapter } {
    const builtin = this.base.find((item) => item.software_key === key)
    if (builtin) return { name: builtin.name_i18n, adapter: builtin.adapter }
    const software = this.find<SoftwareDefinition>(key, 'software', requester, owners)
    return { name: software.name, adapter: adapterOf(software) }
  }
  components(
    requirements: readonly SoftwareRequirement[],
    requester: Owner | undefined,
    owners: Map<string, Owner>,
    os?: DeclaredOs | DetectedOs,
  ): Component[] {
    const result = new Map<string, Component>(),
      visiting = new Set<string>()
    const visit = (requirement: SoftwareRequirement) => {
      if (os && requirement.whenOs && !supportsOs({ kind: 'explicit', selectors: requirement.whenOs }, os))
        return
      if (visiting.has(requirement.software))
        throw new CatalogError('component_cycle', { component: requirement.software })
      const software = this.software(requirement.software, requester, owners)
      software.adapter.validate(requirement.versions)
      const recipeCandidates: LoadedRecipe[] = requirement.recipes.map((key) => {
        const builtin = this.base.find((item) => item.recipe === key)
        if (builtin)
          return {
            key,
            software: builtin.software_key,
            supportedOs: builtin.supportedOs,
            requires: builtin.requires.map((id) => {
              const dependency = this.base.find((item) => item.id === id)!
              return {
                software: dependency.software_key,
                recipes: [dependency.recipe],
                versions: { kind: 'any' } as VersionRule,
              }
            }),
            scripts: builtin.scripts,
            actions: builtin.actions,
            revision: builtin.revision,
          }
        return this.find<LoadedRecipe>(key, 'recipes', requester, owners)
      })
      if (
        !recipeCandidates.length ||
        recipeCandidates.some((recipe) => recipe.software !== requirement.software)
      )
        throw new ServerError('definition_reference')
      const recipe = recipeCandidates.find(
        (item) => !os || supportsOs({ kind: 'explicit', selectors: item.supportedOs }, os),
      )
      if (!recipe) throw new ServerError('recipe_unavailable')
      const previous = result.get(requirement.software)
      const versions = software.adapter.intersect([
        requirement.versions,
        ...(previous ? [previous.versions] : []),
      ])
      if (!versions || (previous && previous.recipe !== recipe.key))
        throw new ServerError('definition_reference')
      visiting.add(requirement.software)
      for (const dependency of recipe.requires ?? []) visit(dependency)
      visiting.delete(requirement.software)
      const builtin = this.base.find((item) => item.software_key === requirement.software)
      const adapterRevision = digest(
        Object.fromEntries(
          Object.entries(software.adapter).map(([k, v]) => [k, typeof v === 'function' ? v.toString() : v]),
        ),
      )
      const component: Component = {
        id: builtin?.id ?? requirement.software,
        software_key: requirement.software,
        name: software.name.zh,
        summary: '',
        name_i18n: software.name,
        summary_i18n: { zh: '', en: '' },
        whenOs: requirement.whenOs,
        supportedOs: os ? recipe.supportedOs : recipeCandidates.flatMap((r) => r.supportedOs),
        requires: (recipe.requires ?? [])
          .filter((r) => !os || !r.whenOs || supportsOs({ kind: 'explicit', selectors: r.whenOs }, os))
          .map((r) => this.base.find((c) => c.software_key === r.software)?.id ?? r.software),
        recipe: recipe.key,
        revision: digest({ recipe: recipe.revision, versions, adapterRevision }),
        scripts: recipe.scripts,
        versions,
        adapter: software.adapter,
        actions: recipe.actions,
      }
      result.set(requirement.software, component)
    }
    for (const requirement of requirements) visit(requirement)
    return requiredSoftware(
      [...result.values()],
      [...result.values()].map((item) => item.id),
    )
  }
  resolveType(
    key: string,
    requester: Owner | undefined,
    owners = this.owners,
    os?: DeclaredOs | DetectedOs,
  ): { type: ServerTypeView; components: readonly Component[] } {
    const builtin = builtinTypes(this.base).find((type) => type.key === key)
    if (builtin) return { type: builtin, components: key === VACANT_TYPE ? [] : this.base }
    const type = this.find<ServerTypeDefinition>(key, 'types', requester, owners)
    const components = this.components(type.requirements, requester, owners, os)
    return {
      type: {
        key,
        name_i18n: type.name,
        supportedOs: type.supportedOs,
        software: components.map(softwareView),
      },
      components,
    }
  }
  groupOptions(
    group: SystemGroupDefinition,
    owner: Owner,
    owners = this.owners,
    os?: DeclaredOs | DetectedOs,
    inheritedKeys?: readonly string[],
  ): TypeOptions {
    const explicit = group.types !== undefined
    const keys = group.types ?? inheritedKeys ?? [VACANT_TYPE]
    // Inherited public types must not become hard dependencies of the group owner.
    const types = keys.map((key) => this.resolveType(key, explicit ? owner : undefined, owners).type)
    const selected = os
      ? group.defaultTypeByOs?.find((rule) => supportsOs({ kind: 'explicit', selectors: rule.whenOs }, os))
          ?.type
      : undefined
    return {
      kind: 'system',
      available: this.isAvailable(owner),
      default_type_key: selected ?? group.defaultType ?? keys[0]!,
      default_type_by_os: group.defaultTypeByOs,
      types,
    }
  }
}
