import { credentialRef, deriveKeyRef, valueAt } from './profiles.ts'

/** The two wire families this page offers. An empty choice keeps the catalog default. */
export type ProtocolChoice = '' | 'openai' | 'anthropic'

export interface ModelName {
  id: string
  name: string
}

export interface ProviderSource {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  defaultBaseURL?: string
}

export interface SettingsNamespace {
  ns: string
  value: unknown
  user?: unknown
  revision: number
}

export interface ModelRow {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  revision: number
  baseURL: string
  defaultBaseURL: string
  protocol: ProtocolChoice
  protocolEditable: boolean
  credentialRef: string | undefined
  models: ModelName[]
}

export type FieldOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Map a stored wire protocol onto the two choices this page shows. */
export function protocolChoice(api: unknown): ProtocolChoice {
  if (api === 'anthropic-messages') return 'anthropic'
  if (api === 'openai-completions' || api === 'openai-responses') return 'openai'
  return ''
}

/** The wire protocol written when the user picks a choice. */
export function protocolWire(choice: ProtocolChoice): 'openai-completions' | 'anthropic-messages' | undefined {
  if (choice === 'openai') return 'openai-completions'
  if (choice === 'anthropic') return 'anthropic-messages'
  return undefined
}

/** Model ids stored on a profile. Discovery fills the list when this is empty. */
export function listedModels(profile: unknown): ModelName[] {
  if (typeof profile !== 'object' || profile === null) return []
  const models = (profile as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const names: ModelName[] = []
  for (const model of models) {
    if (typeof model === 'string' && model !== '') {
      names.push({ id: model, name: model })
      continue
    }
    if (typeof model !== 'object' || model === null) continue
    const id = (model as { id?: unknown }).id
    if (typeof id !== 'string' || id === '') continue
    const name = (model as { name?: unknown }).name
    names.push({ id, name: typeof name === 'string' && name !== '' ? name : id })
  }
  return names
}

function textAt(profile: unknown, key: string): string {
  if (typeof profile !== 'object' || profile === null) return ''
  const value = (profile as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/** A route id Harness will accept. Blank and illegal names are rejected. */
export function providerRoute(name: string): string | undefined {
  const route = name.trim().toLowerCase()
  return ROUTE_PATTERN.test(route) ? route : undefined
}

/** The catalog entry for a typed name, matched by id or display name. */
export function matchProvider(catalog: readonly ProviderSource[], name: string): ProviderSource | undefined {
  const trimmed = name.trim()
  const lower = trimmed.toLowerCase()
  return catalog.find(item => item.provider === trimmed || item.provider === lower || item.displayName.toLowerCase() === lower)
}

/** Catalog rows whose id or display name contains the text being typed. */
export function providerChoices(catalog: readonly ProviderSource[], name: string): ProviderSource[] {
  const query = name.trim().toLowerCase()
  if (query === '') return [...catalog]
  return catalog.filter(item => item.provider.toLowerCase().includes(query) || item.displayName.toLowerCase().includes(query))
}

/** The one provider the current text names. An ambiguous prefix names none. */
export function resolveProvider(catalog: readonly ProviderSource[], name: string): ProviderSource | undefined {
  const exact = matchProvider(catalog, name)
  if (exact !== undefined) return exact
  if (name.trim() === '') return undefined
  const hits = providerChoices(catalog, name)
  return hits.length === 1 ? hits[0] : undefined
}

/** True when this settings namespace has no discovery hook. */
export function missingDiscovery(message: string | undefined): boolean {
  return message !== undefined && message.includes('no model discovery is registered')
}

/** Models already stored for a provider, including catalog defaults. */
export function storedModels(documents: readonly SettingsNamespace[], source: ProviderSource): ModelName[] {
  const document = documents.find(item => item.ns === source.settingsNs)
  if (document === undefined) return []
  return listedModels(valueAt(document.value, source.settingsPath))
}

/** Endpoint the official DeepSeek adapter uses when the profile sets none. */
const DEEPSEEK_OFFICIAL_BASE_URL = 'https://api.deepseek.com/anthropic'

/** The address to show for a provider: a saved one, the catalog default, or DeepSeek's built-in root. */
export function providerBaseURL(source: ProviderSource, documents: readonly SettingsNamespace[]): string {
  const document = documents.find(item => item.ns === source.settingsNs)
  const profile = document === undefined ? undefined : valueAt(document.value, source.settingsPath)
  const stored = textAt(profile, 'baseURL')
  if (stored !== '') return stored
  if (source.defaultBaseURL !== undefined && source.defaultBaseURL !== '') return source.defaultBaseURL
  if (source.provider === 'deepseek-official') return DEEPSEEK_OFFICIAL_BASE_URL
  return ''
}

function userProfile(documents: readonly SettingsNamespace[], provider: ProviderSource): unknown {
  const document = documents.find(item => item.ns === provider.settingsNs)
  if (document?.user === undefined) return undefined
  const profile = valueAt(document.user, provider.settingsPath)
  if (typeof profile !== 'object' || profile === null) return undefined
  if (provider.settingsPath.length > 0) return profile
  const record = profile as Record<string, unknown>
  if (record.baseURL === undefined && record.models === undefined && record.api === undefined && record.apiKeyEnv === undefined) return undefined
  return profile
}

/** Rows the user added. Catalog defaults stay out of the table. */
export function addedRows(catalog: readonly ProviderSource[], documents: readonly SettingsNamespace[]): ModelRow[] {
  const visible = catalog.filter(provider => provider.provider !== 'deepseek-account' && userProfile(documents, provider) !== undefined)
  const known = new Set(catalog.map(provider => provider.provider))
  const pi = documents.find(document => document.ns === 'llm-pi-ai')
  const stored = pi === undefined ? undefined : valueAt(pi.user, ['providers'])
  const custom: ProviderSource[] = []
  if (typeof stored === 'object' && stored !== null) {
    for (const route of Object.keys(stored)) {
      if (known.has(route)) continue
      const profile = (stored as Record<string, unknown>)[route]
      const displayName = textAt(profile, 'displayName')
      custom.push({
        provider: route,
        displayName: displayName === '' ? route : displayName,
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', route],
      })
    }
  }
  return modelRows([...visible, ...custom], documents)
}

export interface ProviderDraft {
  route: string
  displayName: string
  baseURL: string
  protocol: ProtocolChoice
  models: readonly ModelName[]
  withKey: boolean
}

/** Why a draft cannot be saved, when it cannot. */
export function draftError(draft: ProviderDraft, known: boolean): 'route' | 'protocol' | 'baseUrl' | 'models' | undefined {
  if (providerRoute(draft.route) === undefined) return 'route'
  if (!known && draft.protocol === '') return 'protocol'
  if (!known && draft.baseURL.trim() === '') return 'baseUrl'
  if (draft.models.length === 0) return 'models'
  return undefined
}

/** Settings writes that create one provider profile. */
export function createOps(draft: ProviderDraft, source: ProviderSource): FieldOp[] {
  const models = draft.models.map(model => ({ id: model.id, name: model.name }))
  const key = draft.withKey ? deriveKeyRef(source.provider) : undefined
  if (source.settingsPath.length === 0) {
    const ops: FieldOp[] = []
    if (draft.baseURL.trim() !== '') ops.push(fieldOp(source.settingsPath, 'baseURL', draft.baseURL))
    if (key !== undefined) ops.push({ op: 'set', path: ['apiKeyEnv'], value: key })
    ops.push({ op: 'set', path: ['models'], value: models })
    return ops
  }
  const value: Record<string, unknown> = { models }
  if (draft.displayName !== '' && draft.displayName !== source.provider) value.displayName = draft.displayName
  if (draft.baseURL.trim() !== '') value.baseURL = draft.baseURL.trim()
  const wire = protocolWire(draft.protocol)
  if (wire !== undefined) value.api = wire
  if (key !== undefined) value.apiKeyEnv = key
  return [{ op: 'set', path: [...source.settingsPath], value }]
}

/** Check or clear every visible model, leaving models outside this list alone. */
export function toggleAllModels(visible: readonly string[], selected: readonly string[], on: boolean): string[] {
  if (on) {
    const have = new Set(selected)
    return [...selected, ...visible.filter(id => !have.has(id))]
  }
  const hide = new Set(visible)
  return selected.filter(id => !hide.has(id))
}

/** Replace the models a saved provider supports. */
export function modelsOp(path: readonly string[], models: readonly ModelName[]): FieldOp {
  return { op: 'set', path: [...path, 'models'], value: models.map(model => ({ id: model.id, name: model.name })) }
}

/** Remove one added provider. An empty path is the whole settings section and is not removed here. */
export function removeOp(path: readonly string[]): FieldOp | undefined {
  if (path.length === 0) return undefined
  return { op: 'unset', path: [...path] }
}

/** One table row per configurable provider. Account sign-in is not an API route. */
export function modelRows(providers: readonly ProviderSource[], documents: readonly SettingsNamespace[]): ModelRow[] {
  const byNs = new Map(documents.map(document => [document.ns, document]))
  return providers.filter(provider => provider.provider !== 'deepseek-account').map(provider => {
    const document = byNs.get(provider.settingsNs)
    const profile = document === undefined ? undefined : valueAt(document.value, provider.settingsPath)
    return {
      provider: provider.provider,
      displayName: provider.displayName,
      settingsNs: provider.settingsNs,
      settingsPath: provider.settingsPath,
      revision: document?.revision ?? 0,
      baseURL: textAt(profile, 'baseURL'),
      defaultBaseURL: provider.defaultBaseURL ?? '',
      protocol: protocolChoice(typeof profile === 'object' && profile !== null ? (profile as { api?: unknown }).api : undefined),
      protocolEditable: provider.settingsNs === 'llm-pi-ai',
      credentialRef: credentialRef(provider.provider, profile),
      models: listedModels(profile),
    }
  }).sort((left, right) => left.displayName.localeCompare(right.displayName))
}

/** A settings edit for one profile field. An empty value removes the override. */
export function fieldOp(path: readonly string[], field: string, value: string): FieldOp {
  const full = [...path, field]
  const trimmed = value.trim()
  if (trimmed === '') return { op: 'unset', path: full }
  return { op: 'set', path: full, value: trimmed }
}
