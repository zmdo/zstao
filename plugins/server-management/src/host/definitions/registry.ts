import { randomUUID } from 'node:crypto'
import type {
  DefinitionBundle,
  Registration as RegistrationHandle,
  SystemGroupDefinition,
} from '../../shared/contracts/definitions.ts'
import { VACANT_TYPE, type ServerTypeView, type TypeOptions } from '../../shared/definitions.ts'
import { type GroupView } from '../../shared/dto/groups.ts'
import { ServerError } from '../../shared/errors.ts'
import { validateOsSupport, type DeclaredOs, type DetectedOs } from '../../shared/operating-systems.ts'
import type { Db } from '../database/connection.ts'
import { transaction } from '../database/transaction.ts'
import { type GroupRow } from '../groups/persistence/rows.ts'
import { type Component } from './catalog.ts'
import type { Owner, TypeLease } from './model.ts'
import * as repository from './persistence/repository.ts'
import { DefinitionResolver } from './resolver.ts'
import { prepareOwner, snapshotBundle } from './validation.ts'
import { builtinTypes, definitionSignature } from './views.ts'

/** Registrations are atomic. Each lease pins every provider used by the type, including transitive dependencies. */
export class DefinitionRegistry {
  private readonly owners = new Map<string, Owner>()
  private readonly pending = new Set<Promise<unknown>>()
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  private revision = 0
  private readonly db: Db
  private readonly base: readonly Component[]
  private readonly resolver: DefinitionResolver
  constructor(db: Db, base: readonly Component[]) {
    this.db = db
    this.base = base
    this.resolver = new DefinitionResolver(base, this.owners)
  }
  catalogRevision(): number {
    return this.revision
  }
  hasType(key: string): boolean {
    if (builtinTypes(this.base).some((type) => type.key === key)) return true
    for (const owner of this.owners.values())
      if (this.resolver.isAvailable(owner) && owner.types.has(key)) return true
    return false
  }
  /** Built-in types first, then active public contributions ordered by order and stable key. */
  publicCatalog(owners = this.owners): readonly ServerTypeView[] {
    const types = [...builtinTypes(this.base)]
    const seen = new Set(types.map((type) => type.key))
    const entries: { key: string; order: number; owner: Owner }[] = []
    for (const owner of owners.values()) {
      if (!this.resolver.isAvailable(owner)) continue
      for (const [key, order] of owner.publicTypes) entries.push({ key, order, owner })
    }
    entries.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    for (const entry of entries) {
      if (seen.has(entry.key)) continue
      const { type } = this.resolver.resolveType(entry.key, entry.owner, owners)
      seen.add(entry.key)
      types.push(type)
    }
    return types
  }

  registerDefinitions(input: DefinitionBundle, identity: object = input): RegistrationHandle {
    if (this.closed) throw new ServerError('definitions_unavailable')
    // Snapshot metadata now; adapter functions are captured separately and included in the semantic digest.
    const bundle = snapshotBundle(input)
    let record: Owner | undefined,
      cancelled = false
    const ready = this.tail.then(async () => {
      if (cancelled) return
      record = await this.activate(bundle, identity)
      if (cancelled || this.closed) await this.unregister(record)
    })
    this.tail = ready.then(
      () => {},
      () => {},
    )
    this.pending.add(ready)
    void ready.finally(() => this.pending.delete(ready)).catch(() => {})
    return {
      ready,
      dispose: async () => {
        cancelled = true
        await ready
        if (record) await this.unregister(record)
      },
    }
  }

  private async activate(input: DefinitionBundle, identity: object): Promise<Owner> {
    if (this.closed) throw new ServerError('definitions_unavailable')
    const owner = await prepareOwner(input, identity, this.owners.has(input.owner))
    const available = new Map(this.owners)
    available.set(owner.owner, owner)
    for (const recipe of owner.recipes.values()) {
      this.resolver.software(recipe.software, owner, available)
      this.resolver.components(recipe.requires ?? [], owner, available)
    }
    for (const key of owner.types.keys()) this.resolver.resolveType(key, owner, available)
    const inherited = this.publicCatalog(available).map((type) => type.key)
    for (const group of owner.groups.values()) {
      const keys = group.types ?? inherited,
        fallback = group.defaultType ?? keys[0]!
      if (!keys.includes(fallback)) throw new ServerError('group_definition_invalid')
      for (const key of keys)
        this.resolver.resolveType(key, group.types !== undefined ? owner : undefined, available)
      for (const rule of group.defaultTypeByOs ?? []) {
        if (!keys.includes(rule.type)) throw new ServerError('group_definition_invalid')
        validateOsSupport({ kind: 'explicit', selectors: rule.whenOs }, false)
      }
    }
    const saved = new Map<string, SystemGroupDefinition>()
    await transaction(this.db, async (client) => {
      for (const group of owner.groups.values()) {
        const definition = this.resolver.groupOptions(group, owner, available, undefined, inherited)
        const row = (
          await repository.upsertSystemGroup(client, {
            id: randomUUID(),
            name: group.name.zh,
            owner: input.owner,
            groupKey: group.key,
            nameI18n: JSON.stringify(group.name),
            order: group.order ?? 0,
            definition: JSON.stringify({ ...definition, available: false }),
          })
        ).rows[0]!
        saved.set(row.id, group)
      }
      if (this.closed || [...owner.dependencies].some((p) => !this.resolver.isAvailable(p)))
        throw new ServerError('definitions_unavailable')
    })
    owner.groups = saved
    this.owners.set(owner.owner, owner)
    this.revision += 1
    return owner
  }
  defaultOptions(): TypeOptions {
    return {
      kind: 'user',
      available: !this.closed,
      default_type_key: VACANT_TYPE,
      types: structuredClone(this.publicCatalog()),
    }
  }
  view(row: GroupRow, os?: DeclaredOs | DetectedOs): GroupView {
    const owner = row.plugin_id ? this.owners.get(row.plugin_id) : undefined,
      group = owner?.groups.get(row.id)
    const options =
      row.kind === 'user'
        ? this.defaultOptions()
        : owner && group && this.resolver.isAvailable(owner)
          ? this.resolver.groupOptions(group, owner, this.owners, os, this.publicCatalog().map((type) => type.key))
          : {
              kind: 'system' as const,
              available: false,
              types: row.definition.types ?? [],
              default_type_key: row.definition.default_type_key ?? '',
            }
    return { ...row, ...options }
  }
  async options(groupId: string | null, os?: DeclaredOs | DetectedOs): Promise<TypeOptions> {
    if (groupId === null) return this.defaultOptions()
    const row = (await repository.readGroup(this.db, groupId)).rows[0]
    if (!row) throw new ServerError('group_not_found')
    return this.view(row, os)
  }
  /** Read all rows synchronously after the database snapshot; no execution lease or script is exposed. */
  describeType(group: GroupRow | null, key: string, os: DeclaredOs | DetectedOs) {
    if (this.closed) return
    const options = group ? this.view(group) : this.defaultOptions()
    if (!options.available || !options.types.some((type) => type.key === key)) return
    const owner = group?.plugin_id ? this.owners.get(group.plugin_id) : undefined
    const { type, components } = this.resolver.resolveType(key, owner, this.owners, os)
    return {
      type,
      signature: definitionSignature(type, components),
      components: components.map((component) => ({
        software_key: component.software_key,
        adapter: component.adapter,
        versions: component.versions,
      })),
    }
  }
  async lease(
    groupId: string | null,
    key: string,
    os?: DeclaredOs | DetectedOs,
  ): Promise<TypeLease | undefined> {
    if (this.closed) return
    const options = await this.options(groupId)
    if (this.closed || !options.available || !options.types.some((type) => type.key === key)) return
    const owner = [...this.owners.values()].find((o) => groupId !== null && o.groups.has(groupId))
    const { type, components } = this.resolver.resolveType(key, owner, this.owners, os)
    const providers = new Set<Owner>()
    const collect = (item: Owner) => {
      if (providers.has(item)) return
      providers.add(item)
      for (const dep of item.dependencies) collect(dep)
    }
    if (owner) collect(owner)
    if ([...providers].some((item) => !this.resolver.isAvailable(item))) return
    const token = Symbol()
    for (const item of providers) item.leases.add(token)
    let released = false
    return {
      type: structuredClone(type),
      components,
      signature: definitionSignature(type, components),
      release() {
        if (released) return
        released = true
        for (const item of providers) {
          item.leases.delete(token)
          if (!item.leases.size) for (const resolve of item.drained) resolve()
        }
      },
    }
  }
  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.pending])
    await Promise.all([...this.owners.values()].map((owner) => this.unregister(owner)))
  }
  private unregister(owner: Owner): Promise<void> {
    if (owner.closing) return owner.closing
    owner.active = false
    owner.closing = (async () => {
      if (owner.leases.size) await new Promise<void>((resolve) => owner.drained.add(resolve))
      if (this.owners.get(owner.owner) === owner) this.owners.delete(owner.owner)
      this.revision += 1
      owner.drained.clear()
    })()
    return owner.closing
  }
}
