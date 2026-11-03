import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { DashboardError, DashboardService, FxRateService, isRange, type DashboardConfig, type Queryable } from './host/service.ts'
import { isCurrency } from './shared/amount.ts'
import type { Currency, DashboardEvent, SummaryQuery, TransactionQuery, TransactionStatus, TransactionType } from './shared/contracts.ts'

interface HostContext {
  database: { pool: Queryable }
  consoleSession: { read(cookie: string): Promise<unknown> }
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler(request: IncomingMessage, response: ServerResponse): Promise<void>
    }): () => void
  }
  logger: { warn(error: unknown): void; error(error: unknown): void }
  effect(run: () => (() => void) | (() => Promise<void>)): void
  provide(name: string, service: unknown): () => void
}

export interface Config {
  defaultCurrency: Currency
  supportedCurrencies: Currency[]
  timeZone: string
  refreshSeconds: number
  ingestToken?: string
  fx: DashboardConfig['fx']
}

export const Config: Schema<Config> = Schema.object({
  defaultCurrency: Schema.union(['CNY', 'USD']).default('CNY'),
  supportedCurrencies: Schema.array(Schema.union(['CNY', 'USD'])).default(['CNY', 'USD']),
  timeZone: Schema.string().default('Asia/Shanghai'),
  refreshSeconds: Schema.number().default(60),
  ingestToken: Schema.string().default(''),
  fx: Schema.object({
    provider: Schema.union(['frankfurter', 'custom']).default('frankfurter'),
    url: Schema.string().default('https://api.frankfurter.app/latest?from=USD&to=CNY'),
    apiKey: Schema.string().default(''),
    refreshSeconds: Schema.number().default(1800),
    timeoutMs: Schema.number().default(5000),
  }),
})

type DashboardContext = HostContext & {
  dashboard: DashboardService
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dashboard: DashboardService
  }
}

export const inject = ['database', 'consoleSession', 'webServer']

const ROOT = '/console-api/dashboard'

export function apply(ctx: HostContext, config: Config): void {
  const runtime: DashboardConfig = {
    defaultCurrency: config.defaultCurrency,
    timeZone: config.timeZone,
    fx: {
      provider: config.fx.provider,
      url: config.fx.url,
      apiKey: config.fx.apiKey === '' ? undefined : config.fx.apiKey,
      refreshSeconds: config.fx.refreshSeconds,
      timeoutMs: config.fx.timeoutMs,
    },
  }
  const fx = new FxRateService(ctx.database.pool, runtime.fx, ctx.logger)
  const service = new DashboardService(ctx.database.pool, runtime, fx)
  ctx.effect(() => {
    const stopFx = fx.start()
    const stopProvide = ctx.provide('dashboard', service)
    const routes = [
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/summary`, handler: (request, response) => summaryRoute(ctx, service, config, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/transactions`, handler: (request, response) => transactionsRoute(ctx, service, config, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/ingest`, handler: (request, response) => ingestRoute(ctx, service, config, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/import/csv`, handler: (request, response) => importRoute(ctx, service, config, request, response) }),
    ]
    return () => {
      for (const stop of routes) stop()
      stopProvide()
      stopFx()
    }
  })
}

async function summaryRoute(ctx: DashboardContext, service: DashboardService, config: Config, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, config, request)) { send(response, 401, { code: 'auth/required', detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { code: 'request/method', detail: '需要 GET' }); return }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const query = summaryQuery(url, config)
    send(response, 200, await service.summary(query))
  } catch (cause) {
    failure(ctx, response, cause)
  }
}

async function transactionsRoute(ctx: DashboardContext, service: DashboardService, config: Config, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, config, request)) { send(response, 401, { code: 'auth/required', detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { code: 'request/method', detail: '需要 GET' }); return }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const base = summaryQuery(url, config)
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50))
    const typeValue = url.searchParams.get('type')
    const statusValue = url.searchParams.get('status')
    const query: TransactionQuery = {
      ...base,
      limit,
      ...(url.searchParams.get('cursor') === null ? {} : { cursor: url.searchParams.get('cursor') ?? undefined }),
      ...(typeValue === 'income' || typeValue === 'expense' ? { type: typeValue as TransactionType } : {}),
      ...(statusValue === 'posted' || statusValue === 'pending' || statusValue === 'void' ? { status: statusValue as TransactionStatus } : {}),
      ...(url.searchParams.get('source') === null ? {} : { source: url.searchParams.get('source') ?? '' }),
      ...(url.searchParams.get('accountId') === null ? {} : { accountId: url.searchParams.get('accountId') ?? '' }),
    }
    send(response, 200, await service.transactions(query))
  } catch (cause) {
    failure(ctx, response, cause)
  }
}

async function ingestRoute(ctx: DashboardContext, service: DashboardService, config: Config, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, config, request)) { send(response, 401, { code: 'auth/required', detail: '未登录' }); return }
  if (request.method !== 'POST') { send(response, 405, { code: 'request/method', detail: '需要 POST' }); return }
  try {
    const body = await readJson(request)
    const events = Array.isArray(body.events) ? body.events : [body]
    if (events.length === 0) throw new DashboardError('dashboard/body', '没有事件')
    const results = await service.ingestMany(events as DashboardEvent[])
    send(response, 200, { results })
  } catch (cause) {
    failure(ctx, response, cause)
  }
}

async function importRoute(ctx: DashboardContext, service: DashboardService, config: Config, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, config, request)) { send(response, 401, { code: 'auth/required', detail: '未登录' }); return }
  if (request.method !== 'POST') { send(response, 405, { code: 'request/method', detail: '需要 POST' }); return }
  try {
    const text = await readText(request, 1_048_576)
    send(response, 200, await service.importCsv(text))
  } catch (cause) {
    failure(ctx, response, cause)
  }
}

function summaryQuery(url: URL, config: Config): SummaryQuery {
  const range = url.searchParams.get('range') ?? '30d'
  if (!isRange(range)) throw new DashboardError('dashboard/range', 'range 不合法')
  const currency = url.searchParams.get('currency') ?? config.defaultCurrency
  if (!isCurrency(currency) || !config.supportedCurrencies.includes(currency)) throw new DashboardError('dashboard/currency', '币种不合法')
  return { range, currency }
}

async function authorized(ctx: HostContext, config: Config, request: IncomingMessage): Promise<boolean> {
  if (await ctx.consoleSession.read(cookieOf(request)) !== undefined) return true
  if (config.ingestToken === undefined || config.ingestToken === '') return false
  const header = request.headers.authorization ?? ''
  if (!header.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice(7))
  const expected = Buffer.from(config.ingestToken)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function cookieOf(request: IncomingMessage): string {
  const value = request.headers.cookie
  return Array.isArray(value) ? value.join('; ') : value ?? ''
}

function failure(ctx: HostContext, response: ServerResponse, cause: unknown): void {
  if (cause instanceof DashboardError) {
    send(response, cause.status, { code: cause.code, detail: cause.message })
    return
  }
  ctx.logger.warn(cause)
  send(response, 500, { code: 'dashboard/failed', detail: '操作未完成，请重试' })
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readText(request, 65_536)
  let value: unknown
  try { value = JSON.parse(text) } catch (cause) { throw new DashboardError('request/json', '请求不是有效 JSON', 400, { cause }) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new DashboardError('request/json', '请求必须是 JSON 对象')
  return value as Record<string, unknown>
}

async function readText(request: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > max) throw new DashboardError('request/too-large', '请求过大', 413)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
