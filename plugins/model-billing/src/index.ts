import { randomUUID } from 'node:crypto'
interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>
}

type DashboardEvent =
  | { kind: 'account'; source: string; externalId: string; provider: string; displayName: string; accountKind?: 'cloud' | 'llm' | 'bank' | 'other'; currency?: 'CNY' | 'USD' }
  | { kind: 'balance'; source: string; externalId: string; accountExternalId: string; amount: string; currency?: 'CNY' | 'USD'; capturedAt?: string }
  | { kind: 'transaction'; source: string; externalId: string; type: 'income' | 'expense'; title: string; amount: string; currency?: 'CNY' | 'USD'; occurredAt: string; metadata?: Record<string, unknown> }

interface DashboardIngest {
  ingest(event: DashboardEvent): Promise<{ id: string; duplicate: boolean }>
}

interface HostContext {
  dashboard: DashboardIngest
  database: { pool: Queryable }
  credentials: { resolve(ref: string): Promise<{ value: string } | undefined> }
  on(name: string, listener: (...args: never[]) => unknown): () => void
  effect(run: () => (() => void)): void
  logger: { warn(error: unknown): void }
}

interface Price {
  currency: 'CNY' | 'USD'
  inputPerMillion: number
  outputPerMillion: number
  cacheReadPerMillion?: number
  cacheWritePerMillion?: number
}

interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

interface StreamChunk {
  type: string
  usage?: Usage
}

interface CallOptions {
  provider?: string
  model?: string
  sessionId?: string
}

const ROOT = 'https://api.deepseek.com'
const SOURCE = '@smp/console-model-billing'
const DEEPSEEK = 'deepseek-official'
const DEFAULT_PRICES: Record<string, Price> = {
  'deepseek-flash': { currency: 'CNY', inputPerMillion: 0.5, outputPerMillion: 2 },
  'deepseek-v4-pro': { currency: 'CNY', inputPerMillion: 1, outputPerMillion: 4 },
}

export const inject = ['dashboard', 'database', 'credentials']

export function apply(ctx: HostContext): void {
  let stopped = false
  const prices = new Map(Object.entries(DEFAULT_PRICES))
  const timers: NodeJS.Timeout[] = []

  const refreshPrices = (): void => {
    void ctx.database.pool.query<{ provider: string; config: Record<string, unknown> | null }>(
      `select provider, config from console_model_profiles where provider = 'deepseek-official'`,
    ).then(result => {
      const config = result.rows[0]?.config
      const pricing = config?.pricing
      if (typeof pricing === 'object' && pricing !== null) {
        const record = pricing as Record<string, unknown>
        const models = record.models
        if (typeof models === 'object' && models !== null) {
          for (const [model, value] of Object.entries(models as Record<string, unknown>)) {
            const parsed = priceOf(value)
            if (parsed !== undefined) prices.set(model, parsed)
          }
        } else {
          const parsed = priceOf(pricing)
          if (parsed !== undefined) {
            for (const model of Object.keys(DEFAULT_PRICES)) prices.set(model, parsed)
          }
        }
      }
    }).catch((cause: unknown) => { if (!stopped) ctx.logger.warn(cause) })
  }

  const balance = async (): Promise<void> => {
    try {
      const profile = await ctx.database.pool.query<{ credential_ref: string | null }>(
        `select credential_ref from console_model_profiles where provider = 'deepseek-official' limit 1`,
      )
      const ref = profile.rows[0]?.credential_ref
      if (ref === null || ref === undefined) return
      const credential = await ctx.credentials.resolve(ref)
      if (credential === undefined) return
      const response = await fetch(`${ROOT}/user/balance`, { headers: { authorization: `Bearer ${credential.value}` } })
      if (!response.ok) return
      const body = await response.json() as { balance_infos?: Array<{ currency?: string; total_balance?: string }> }
      const info = body.balance_infos?.find(item => item.currency === 'CNY') ?? body.balance_infos?.[0]
      if (info?.total_balance === undefined) return
      await ctx.dashboard.ingest({
        kind: 'account',
        source: SOURCE,
        externalId: DEEPSEEK,
        provider: 'DeepSeek',
        displayName: 'DeepSeek',
        accountKind: 'llm',
        currency: info.currency === 'USD' ? 'USD' : 'CNY',
      })
      const now = new Date()
      await ctx.dashboard.ingest({
        kind: 'balance',
        source: SOURCE,
        externalId: `deepseek-balance:${now.toISOString()}`,
        accountExternalId: DEEPSEEK,
        amount: info.total_balance,
        currency: info.currency === 'USD' ? 'USD' : 'CNY',
        capturedAt: now.toISOString(),
      })
    } catch (cause) {
      if (!stopped) ctx.logger.warn(cause)
    }
  }

  ctx.effect(() => {
    refreshPrices()
    void balance()
    const stopSettings = ctx.on('settings/document-updated', (() => { refreshPrices() }) as (...args: never[]) => unknown)
    const stopAdapters = ctx.on('llm/adapters-updated', (() => { refreshPrices() }) as (...args: never[]) => unknown)
    const stopStream = ctx.on('llm/stream', ((options: CallOptions, next: () => AsyncIterable<StreamChunk>) => {
      if (options.provider !== DEEPSEEK) return next()
      return billStream(ctx, prices, options, next)
    }) as (...args: never[]) => unknown)
    timers.push(setInterval(() => { void balance() }, 10 * 60_000))
    return () => {
      stopped = true
      stopSettings()
      stopAdapters()
      stopStream()
      for (const timer of timers) clearInterval(timer)
      timers.length = 0
    }
  })
}

async function* billStream(ctx: HostContext, prices: Map<string, Price>, options: CallOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  const callId = randomUUID()
  let usage: Usage | undefined
  for await (const chunk of next()) {
    if (chunk.type === 'usage' && chunk.usage !== undefined) usage = chunk.usage
    yield chunk
  }
  if (usage === undefined) return
  const model = options.model ?? 'unknown'
  const price = prices.get(model)
  if (price === undefined) {
    ctx.logger.warn(new Error(`model price missing: ${model}`))
    return
  }
  const amount = cost(usage, price)
  if (amount <= 0) return
  try {
    await ctx.dashboard.ingest({
      kind: 'transaction',
      source: SOURCE,
      externalId: `model-call:${callId}`,
      type: 'expense',
      title: `模型调用 · ${model}`,
      amount: amount.toFixed(price.currency === 'USD' ? 2 : 2),
      currency: price.currency,
      occurredAt: new Date().toISOString(),
      metadata: { model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens ?? 0 },
    })
  } catch (cause) {
    ctx.logger.warn(cause)
  }
}

function cost(usage: Usage, price: Price): number {
  const input = (usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) / 1_000_000 * price.inputPerMillion
  const output = usage.outputTokens / 1_000_000 * price.outputPerMillion
  return Math.round((input + output) * 100) / 100
}

function priceOf(value: unknown): Price | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  const currency = item.currency === 'USD' ? 'USD' : item.currency === 'CNY' ? 'CNY' : undefined
  const input = Number(item.inputPerMillion)
  const output = Number(item.outputPerMillion)
  if (currency === undefined || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return undefined
  const cacheRead = item.cacheReadPerMillion === undefined ? undefined : Number(item.cacheReadPerMillion)
  const cacheWrite = item.cacheWritePerMillion === undefined ? undefined : Number(item.cacheWritePerMillion)
  return {
    currency,
    inputPerMillion: input,
    outputPerMillion: output,
    ...(cacheRead !== undefined && Number.isFinite(cacheRead) ? { cacheReadPerMillion: cacheRead } : {}),
    ...(cacheWrite !== undefined && Number.isFinite(cacheWrite) ? { cacheWritePerMillion: cacheWrite } : {}),
  }
}
