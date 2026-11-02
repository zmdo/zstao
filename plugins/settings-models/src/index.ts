import { modelProfileRecords, type ConfigurableProvider, type SettingsDocument } from './profiles.ts'
import { replaceModelProfiles, type Queryable, type StoredModelProfile } from './store.ts'

interface PoolClient extends Queryable {
  release(): void
}

interface ModelsCtx {
  database: { pool: { connect(): Promise<PoolClient> } }
  secrets: { encrypt(plaintext: string): string }
  settings: { describe(options?: { redactSecrets?: boolean }): SettingsDocument[] }
  llm: { listConfigurableProviders(): ConfigurableProvider[] }
  credentials: { resolve(ref: string): Promise<{ value: string } | undefined> }
  on(name: string, listener: (...args: never[]) => void): () => void
  effect(run: () => (() => void)): void
  logger: { error(error: unknown): void }
}

export const inject = ['database', 'secrets', 'settings', 'llm', 'credentials']

export function apply(ctx: ModelsCtx): void {
  let stopped = false
  let tail = Promise.resolve()
  const enqueue = (): void => {
    tail = tail.then(async () => {
      if (!stopped) await syncModels(ctx)
    }).catch((error: unknown) => {
      if (!stopped) ctx.logger.error(error)
    })
  }
  ctx.effect(() => {
    stopped = false
    const stopSettings = ctx.on('settings/document-updated', ((ns: string) => {
      if (!ctx.llm.listConfigurableProviders().some(row => row.settingsNs === ns)) return
      enqueue()
    }) as (...args: never[]) => void)
    const stopProviders = ctx.on('llm/adapters-updated', (() => { enqueue() }) as (...args: never[]) => void)
    const stopCredentials = ctx.on('credentials/reference-updated', (() => { enqueue() }) as (...args: never[]) => void)
    enqueue()
    return () => {
      stopped = true
      stopSettings()
      stopProviders()
      stopCredentials()
    }
  })
}

/** Read the harness model directory and mirror it. Secrets stay encrypted. */
async function syncModels(ctx: ModelsCtx): Promise<void> {
  const providers = ctx.llm.listConfigurableProviders()
  const documents = ctx.settings.describe({ redactSecrets: true })
  const records = modelProfileRecords(providers, documents)
  const rows: StoredModelProfile[] = []
  for (const record of records) {
    let credentialCiphertext: string | null = null
    if (record.credentialRef !== undefined) {
      const resolved = await ctx.credentials.resolve(record.credentialRef)
      if (resolved !== undefined) credentialCiphertext = ctx.secrets.encrypt(resolved.value)
    }
    rows.push({ ...record, credentialCiphertext })
  }
  const client = await ctx.database.pool.connect()
  try {
    await replaceModelProfiles(client, rows)
  } finally {
    client.release()
  }
}
