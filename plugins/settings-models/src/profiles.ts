/** One configurable model route, as the harness directory lists it. */
export interface ConfigurableProvider {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
}

/** One settings document after secret fields have been removed. */
export interface SettingsDocument {
  ns: string
  value: unknown
  revision: number
}

/** A model profile ready to store. The credential value is not part of this record. */
export interface ModelProfileRecord {
  provider: string
  settingsNs: string
  settingsPath: readonly string[]
  displayName: string
  config: unknown
  credentialRef: string | undefined
  revision: number
}

/** The conventional credential reference for a provider route. */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** Walk a settings document to the provider profile. */
export function valueAt(root: unknown, path: readonly string[]): unknown {
  let current = root
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * The credential reference this profile uses. An account route has none.
 * A named `apiKeyEnv` wins; otherwise the route uses the derived reference.
 */
export function credentialRef(provider: string, profile: unknown): string | undefined {
  if (provider === 'deepseek-account') return undefined
  if (typeof profile === 'object' && profile !== null) {
    const named = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    if (typeof named === 'string' && named !== '') return named
  }
  return deriveKeyRef(provider)
}

/** Join the provider directory with the redacted settings documents. */
export function modelProfileRecords(
  providers: readonly ConfigurableProvider[],
  documents: readonly SettingsDocument[],
): ModelProfileRecord[] {
  const byNs = new Map(documents.map(document => [document.ns, document]))
  return providers.map(provider => {
    const document = byNs.get(provider.settingsNs)
    const config = document === undefined ? undefined : valueAt(document.value, provider.settingsPath)
    return {
      provider: provider.provider,
      settingsNs: provider.settingsNs,
      settingsPath: provider.settingsPath,
      displayName: provider.displayName,
      config,
      credentialRef: credentialRef(provider.provider, config),
      revision: document?.revision ?? 0,
    }
  })
}
