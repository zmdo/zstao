import type {
  ExtensionCatalogEntry,
  ExtensionKind,
  ExtensionScope,
  ServerExtensionBundle,
} from '../../shared/contracts/extensions.ts'
import type { Json, LocalizedText } from '../../shared/contracts/common.ts'
import type { ServerDto } from '../../shared/dto/servers.ts'
import type { ServerExtensionRuntime } from './runtime.ts'
import { ServerError } from '../../shared/errors.ts'
import { validateOsSupport, type DeclaredOs, type DetectedOs, supportsOs } from '../../shared/operating-systems.ts'
import type { DefinitionRegistry } from '../definitions/registry.ts'
import { loadScript, type LoadedScript } from '../recipes/script.ts'

const KEY = /^[a-z][a-z0-9-]{0,63}$/
const PACKAGE = /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/
const EXTENSION_KEYS = new Set(['contractVersion', 'owner', 'panels', 'settings', 'queries', 'inspections'])

interface Installed {
  owner: string
  entries: ExtensionCatalogEntry[]
  identity: object
  runtime: ServerExtensionRuntime
  scripts: Map<string, LoadedScript>
  users: Set<Promise<void>>
}

/** Owns extension generations and drains admitted callbacks on withdrawal. */
export class ServerExtensionRegistry {
  private readonly definitions: DefinitionRegistry
  private readonly owners = new Map<string, Installed>()
  private revision = 0
  private closed = false
  private tail: Promise<void> = Promise.resolve()

  constructor(definitions: DefinitionRegistry) {
    this.definitions = definitions
  }

  catalogRevision(): number {
    return this.revision
  }

  registerExtensions(
    input: ServerExtensionBundle,
    identity: object = input,
    runtime: ServerExtensionRuntime = {},
  ): {
    ready: Promise<void>
    dispose(): Promise<void>
  } {
    if (this.closed) throw new ServerError('definitions_unavailable')
    let record: Installed | undefined
    let cancelled = false
    const ready = this.tail.then(async () => {
      if (cancelled) return
      record = await this.activate(input, identity, runtime)
      if (cancelled || this.closed) {
        await this.remove(record)
        record = undefined
      }
    })
    this.tail = ready.then(
      () => {},
      () => {},
    )
    return {
      ready,
      dispose: async () => {
        cancelled = true
        await ready
        if (record !== undefined) await this.remove(record)
      },
    }
  }

  list(typeKey?: string, os?: DeclaredOs | DetectedOs): readonly ExtensionCatalogEntry[] {
    return [...this.owners.values()]
      .flatMap((installed) => installed.entries)
      .filter((entry) => {
        if (typeKey !== undefined && entry.appliesTo.types !== undefined && !entry.appliesTo.types.includes(typeKey))
          return false
        if (os !== undefined && entry.appliesTo.os !== undefined && !supportsOs(entry.appliesTo.os, os))
          return false
        return true
      })
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
  }

  inspection(key: string): { entry: ExtensionCatalogEntry; script: LoadedScript; runtime: NonNullable<ServerExtensionRuntime['inspections']>[string] } | undefined {
    for (const installed of this.owners.values()) {
      const entry = installed.entries.find((item) => item.key === key && item.kind === 'inspection')
      const script = installed.scripts.get(key)
      const runtime = installed.runtime.inspections?.[key.slice(installed.owner.length + 1)]
      if (entry !== undefined && script !== undefined && runtime !== undefined) return { entry, script, runtime }
    }
    return undefined
  }

  assertCurrent(entry: ExtensionCatalogEntry): void {
    if (!this.owners.get(entry.owner)?.entries.includes(entry))
      throw new ServerError(entry.kind === 'inspection' ? 'extension_inspection_unavailable' : 'extension_unavailable', { key: entry.key })
  }

  /** Withdraw immediately; drain admitted callbacks before releasing plugin resources. */
  retain(entry: ExtensionCatalogEntry): () => void {
    this.assertCurrent(entry)
    const installed = this.owners.get(entry.owner)!
    let done!: () => void
    const pending = new Promise<void>((resolve) => { done = resolve })
    installed.users.add(pending)
    return () => { installed.users.delete(pending); done() }
  }

  inspectionsFor(server: Pick<ServerDto, 'type_key' | 'declared_os'>): readonly ExtensionCatalogEntry[] {
    return this.list(server.type_key, server.declared_os).filter((entry) => entry.kind === 'inspection')
  }

  catalogFor(server: Pick<ServerDto, 'type_key' | 'declared_os'>): readonly ExtensionCatalogEntry[] {
    return this.list(server.type_key, server.declared_os)
  }

  entry(key: string, kind: ExtensionKind): { entry: ExtensionCatalogEntry; runtime: ServerExtensionRuntime } | undefined {
    for (const installed of this.owners.values()) {
      const entry = installed.entries.find((item) => item.key === key && item.kind === kind)
      if (entry !== undefined) return { entry, runtime: installed.runtime }
    }
    return undefined
  }

  async runQuery(server: ServerDto, key: string, search: URLSearchParams): Promise<Json> {
    const found = this.entry(key, 'query')
    if (found === undefined) throw new ServerError('extension_not_found', { key })
    if (!this.applies(found.entry, server)) throw new ServerError('extension_unavailable', { key })
    const handler = found.runtime.queries?.[key.slice(found.entry.owner.length + 1)]
    if (handler === undefined) throw new ServerError('extension_query_unavailable', { key })
    const release = this.retain(found.entry)
    try {
      const result = await handler(server, search)
      this.assertCurrent(found.entry)
      return result
    } finally {
      release()
    }
  }

  settings(server: Pick<ServerDto, 'type_key' | 'declared_os'>, key: string): { entry: ExtensionCatalogEntry; runtime: { defaults: Json; validate(value: unknown): Json } } {
    const found = this.entry(key, 'settings')
    if (found === undefined) throw new ServerError('extension_not_found', { key })
    if (!this.applies(found.entry, server)) throw new ServerError('extension_unavailable', { key })
    const handler = found.runtime.settings?.[key.slice(found.entry.owner.length + 1)]
    if (handler === undefined) throw new ServerError('extension_settings_unavailable', { key })
    return { entry: found.entry, runtime: handler }
  }

  private applies(entry: ExtensionCatalogEntry, server: Pick<ServerDto, 'type_key' | 'declared_os'>): boolean {
    if (entry.appliesTo.types !== undefined && !entry.appliesTo.types.includes(server.type_key)) return false
    if (entry.appliesTo.os !== undefined && !supportsOs(entry.appliesTo.os, server.declared_os)) return false
    return true
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.owners.values()].map((record) => this.remove(record)))
    await this.tail
  }

  private async activate(input: ServerExtensionBundle, identity: object, runtime: ServerExtensionRuntime): Promise<Installed> {
    if (this.closed) throw new ServerError('definitions_unavailable')
    if (input.contractVersion !== 1 || !PACKAGE.test(input.owner) || input.owner === 'builtin')
      throw new ServerError('extension_definition_invalid')
    for (const key of Object.keys(input))
      if (!EXTENSION_KEYS.has(key)) throw new ServerError('extension_definition_invalid', { field: key })
    if (this.owners.has(input.owner)) throw new ServerError('extension_registration_exists')
    const entries: ExtensionCatalogEntry[] = []
    const scripts = new Map<string, LoadedScript>()
    const keys = new Set<string>()
    const add = async (
      kind: ExtensionKind,
      items:
        | readonly { key: string; name: LocalizedText; order?: number; appliesTo?: ExtensionScope }[]
        | undefined,
    ) => {
      for (const item of items ?? []) {
        if (!KEY.test(item.key)) throw new ServerError('extension_definition_invalid')
        const key = `${input.owner}/${item.key}`
        if (keys.has(key)) throw new ServerError('extension_definition_conflict', { key })
        validateText(item.name)
        if (kind === 'settings' && (!('revision' in item) || typeof item.revision !== 'string' || !item.revision.trim() || item.revision.length > 128))
          throw new ServerError('extension_definition_invalid', { field: 'revision' })
        if (kind === 'settings' && 'sensitive' in item && item.sensitive === true)
          throw new ServerError('extension_definition_invalid', { field: 'sensitive' })
        if (item.order !== undefined && !Number.isSafeInteger(item.order))
          throw new ServerError('extension_definition_invalid')
        const appliesTo = item.appliesTo ?? {}
        if (appliesTo.types !== undefined && appliesTo.types.length === 0)
          throw new ServerError('extension_definition_invalid')
        for (const type of appliesTo.types ?? []) {
          if (!this.definitions.hasType(type)) throw new ServerError('definition_reference', { detail: type })
        }
        if (appliesTo.os !== undefined) validateOsSupport(appliesTo.os, false)
        keys.add(key)
        if (kind === 'inspection') {
          const inspection = item as { script?: Parameters<typeof loadScript>[0] }
          if (inspection.script === undefined) throw new ServerError('extension_definition_invalid', { field: 'script' })
          scripts.set(key, await loadScript(inspection.script))
        }
        entries.push({
          key,
          owner: input.owner,
          kind,
          name: { ...item.name },
          order: item.order ?? 0,
          appliesTo: structuredClone(appliesTo),
          ...(kind === 'settings' && 'revision' in item ? { settingsRevision: String(item.revision) } : {}),
          ...(kind === 'settings' && 'affectsExecution' in item && item.affectsExecution === true
            ? { affectsExecution: true }
            : {}),
          ...(kind === 'inspection' && 'settingsKey' in item && typeof item.settingsKey === 'string'
            ? { settingsKey: item.settingsKey }
            : {}),
        })
      }
    }
    await add('panel', input.panels)
    await add('settings', input.settings)
    await add('query', input.queries)
    await add('inspection', input.inspections)
    const record: Installed = { owner: input.owner, entries, identity, runtime, scripts, users: new Set() }
    this.owners.set(input.owner, record)
    this.revision += 1
    return record
  }

  private async remove(record: Installed): Promise<void> {
    if (this.owners.get(record.owner) === record) {
      this.owners.delete(record.owner)
      this.revision += 1
    }
    await Promise.all(record.users)
  }
}

function validateText(text: LocalizedText): void {
  if (!text.zh.trim() || !text.en.trim() || text.zh.length > 80 || text.en.length > 80)
    throw new ServerError('extension_definition_invalid')
}
