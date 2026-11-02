import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Pool } from 'pg'
import { accountFromCookie, decideLogin, ensureAccount, findAccount, passwordIsDefault, type AccountRow } from './account.ts'
import { clearDshCookieHeaders, dshAuthCookieNames, indexGate, smpSessionValue, tokenExchangeUrl } from './gate.ts'
import { LOGIN_PAGE } from './login-page.ts'
import { clearSessionCookie, openSession, sealSession, sessionCookie } from './session.ts'
import { beginTotp, changePassword, changeUsername, confirmTotp, disableTotp } from './security.ts'
import { loadLanding, loadSidebar, preferencePatch, saveLanding, saveSidebar } from './landing.ts'
import { loadMenu, menuDraft, saveMenu } from './menu.ts'
import { loadSite, saveSite, siteDraft, siteView } from './site.ts'

interface IndexRequest {
  method?: string
  url?: string
  headers: { cookie?: string | string[] }
}

interface IndexResponse {
  setHeader?(name: string, value: string | readonly string[]): void
  writeHead(status: number, headers?: Record<string, string | readonly string[]>): unknown
  end(body?: string): unknown
}

interface Admission {
  rejection?: number
}

interface ConnectionService {
  authorizeIndex(request: IndexRequest, response: IndexResponse): boolean
  authenticatedUrl(baseUrl: string): string
  admit(request: IndexRequest): Admission
}

/** Read a console session. Column plugins call this instead of parsing the cookie. */
export class ConsoleSession extends Service {
  private readonly pool: Pool
  private readonly secret: string

  constructor(ctx: Context, pool: Pool, secret: string) {
    super(ctx, 'consoleSession')
    this.pool = pool
    this.secret = secret
  }

  read(cookieHeader: string): Promise<AccountRow | undefined> {
    return accountFromCookie(this.pool, this.secret, cookieHeader)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    consoleSession: ConsoleSession
  }
}

interface HostCtx extends Context {
  connection: ConnectionService
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
  database: { pool: Pool }
}

export interface Config {
  sessionSecret: string
  initialUsername: string
  initialPassword?: string
}

export const Config: Schema<Config> = Schema.object({
  sessionSecret: String,
  initialUsername: Schema.string().default('admin'),
  initialPassword: Schema.string(),
})

export const inject = ['connection', 'webServer', 'database']

const BODY_LIMIT = 64 * 1024
const SITE_BODY_LIMIT = 512 * 1024

function cookieHeader(request: { headers: { cookie?: string | string[] } }): string {
  const value = request.headers.cookie
  return Array.isArray(value) ? value.join('; ') : value ?? ''
}

function launchToken(connection: ConnectionService): string | undefined {
  return new URL(connection.authenticatedUrl('http://127.0.0.1/')).searchParams.get('token') ?? undefined
}

function expirePageConnection(response: IndexResponse, header: string): void {
  const clearing = clearDshCookieHeaders(dshAuthCookieNames(header))
  if (clearing.length > 0) response.setHeader?.('set-cookie', clearing)
}

async function readJson(request: IncomingMessage, limit = BODY_LIMIT): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error('body')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function sendJson(response: ServerResponse, status: number, body: unknown, cookie?: string): void {
  const headers: Record<string, string | readonly string[]> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }
  if (cookie !== undefined) headers['set-cookie'] = cookie
  response.writeHead(status, headers)
  response.end(JSON.stringify(body))
}

function field(body: unknown, name: string): string | undefined {
  if (body === null || typeof body !== 'object' || !(name in body)) return undefined
  const value = (body as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * authorizeIndex cannot wait, so the index gate trusts the signature only.
 * Issuing the cookie and reading an account both go through the database.
 * The generator is the plugin effect: a nested effect would keep the fiber
 * active when the first account cannot be created.
 */
export async function* apply(ctx: HostCtx, config: Config): AsyncGenerator<() => void> {
  await ensureAccount(ctx.database.pool, config)
  const secret = config.sessionSecret
  const session = new ConsoleSession(ctx, ctx.database.pool, secret)

  yield ctx.webServer.register({
    kind: 'exact',
    path: '/login',
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      const header = cookieHeader(request)
      if (await session.read(header) !== undefined) {
        response.writeHead(303, { location: '/', 'cache-control': 'no-store' })
        response.end()
        return
      }
      const clearing = clearDshCookieHeaders(dshAuthCookieNames(header))
      const headers: Record<string, string | readonly string[]> = {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      }
      if (clearing.length > 0) headers['set-cookie'] = clearing
      response.writeHead(200, headers)
      response.end(request.method === 'HEAD' ? undefined : LOGIN_PAGE)
    },
  })

  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/auth/login',
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      let body: unknown
      try {
        body = await readJson(request)
      } catch (error) {
        void error
        sendJson(response, 400, { detail: '请求无法读取' })
        return
      }
      const username = field(body, 'username')?.trim() ?? ''
      const password = field(body, 'password') ?? ''
      const account = username === '' ? undefined : await findAccount(ctx.database.pool, username)
      const decision = decideLogin(account, password, field(body, 'totp_code'))
      if (decision.kind === 'unauthorized') {
        sendJson(response, 401, { detail: decision.detail })
        return
      }
      if (decision.kind === 'totp') {
        sendJson(response, 200, { ok: false, totp_required: true })
        return
      }
      sendJson(response, 200, { ok: true }, sessionCookie(sealSession(decision.username, secret)))
    },
  })

  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/auth/logout',
    handler: (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(204, { 'set-cookie': clearSessionCookie(), 'cache-control': 'no-store' })
      response.end()
    },
  })

  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/auth/me',
    handler: async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
        response.end()
        return
      }
      const account = await session.read(cookieHeader(request))
      if (account === undefined) {
        sendJson(response, 200, { authenticated: false, password_is_default: false, totp_enabled: false })
        return
      }
      sendJson(response, 200, {
        authenticated: true,
        username: account.username,
        password_is_default: passwordIsDefault(account.password_hash),
        totp_enabled: account.totp_enabled,
      })
    },
  })

  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/auth/session',
    handler: async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
        response.end()
        return
      }
      if (await session.read(cookieHeader(request)) === undefined) {
        sendJson(response, 401, { detail: '未登录' })
        return
      }
      sendJson(response, 200, { ok: true })
    },
  })

  yield* siteRoutes(ctx, session)
  yield* menuRoutes(ctx, session)
  yield* landingRoutes(ctx, session)
  yield* securityRoutes(ctx, secret, session)

  const connection = ctx.connection
  const original = connection.authorizeIndex.bind(connection)
  connection.authorizeIndex = (request, response) => {
    const header = cookieHeader(request)
    const signedIn = openSession(smpSessionValue(header) ?? '', secret) !== undefined
    const gate = indexGate(signedIn, !('rejection' in connection.admit(request)))
    if (gate === 'login') {
      expirePageConnection(response, header)
      response.writeHead(303, { location: '/login', 'cache-control': 'no-store' })
      response.end()
      return false
    }
    if (gate === 'app') return original(request, response)
    const token = launchToken(connection)
    if (token === undefined || request.method !== 'GET') return original(request, response)
    return original({
      method: request.method,
      url: tokenExchangeUrl(request.url ?? '/', token),
      headers: request.headers,
    }, response)
  }
  yield () => {
    connection.authorizeIndex = original
  }
}

async function* siteRoutes(ctx: HostCtx, session: ConsoleSession): AsyncGenerator<() => void> {
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/site',
    handler: async (request, response) => {
      if (request.method === 'GET') {
        sendJson(response, 200, siteView(await loadSite(ctx.database.pool)))
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'GET, POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      if (await session.read(cookieHeader(request)) === undefined) {
        sendJson(response, 401, { detail: '未登录' })
        return
      }
      let body: unknown
      try {
        body = await readJson(request, SITE_BODY_LIMIT)
      } catch (error) {
        void error
        sendJson(response, 400, { detail: '请求无法读取' })
        return
      }
      const title = field(body, 'title')
      const icon = field(body, 'icon')
      if (title === undefined || icon === undefined) {
        sendJson(response, 400, { detail: '请求无法读取' })
        return
      }
      const draft = siteDraft({ title, icon })
      if (!draft.ok) {
        sendJson(response, 400, { detail: draft.error === 'title' ? '标题不能超过 80 个字' : '图标需要是 256KB 以内的图片' })
        return
      }
      await saveSite(ctx.database.pool, draft.title, draft.icon)
      sendJson(response, 200, siteView(draft))
    },
  })
}

async function* menuRoutes(ctx: HostCtx, session: ConsoleSession): AsyncGenerator<() => void> {
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/menu',
    handler: async (request, response) => {
      if (await session.read(cookieHeader(request)) === undefined) {
        sendJson(response, 401, { detail: '未登录' })
        return
      }
      if (request.method === 'GET') {
        sendJson(response, 200, await loadMenu(ctx.database.pool))
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'GET, POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      let body: unknown
      try {
        body = await readJson(request)
      } catch (error) {
        void error
        sendJson(response, 400, { detail: '请求无法读取' })
        return
      }
      const draft = menuDraft(body)
      if (!draft.ok) {
        sendJson(response, 400, { detail: '分组不能超过 40 个字' })
        return
      }
      await saveMenu(ctx.database.pool, draft.layout)
      sendJson(response, 200, draft.layout)
    },
  })
}

async function* landingRoutes(ctx: HostCtx, session: ConsoleSession): AsyncGenerator<() => void> {
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/landing',
    handler: async (request, response) => {
      if (await session.read(cookieHeader(request)) === undefined) {
        sendJson(response, 401, { detail: '未登录' })
        return
      }
      if (request.method === 'GET') {
        sendJson(response, 200, {
          page: await loadLanding(ctx.database.pool),
          sidebar: await loadSidebar(ctx.database.pool),
        })
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'GET, POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      let body: unknown
      try {
        body = await readJson(request)
      } catch (error) {
        void error
        sendJson(response, 400, { detail: '请求无法读取' })
        return
      }
      const draft = preferencePatch(body)
      if (!draft.ok) {
        sendJson(response, 400, { detail: '页面不对' })
        return
      }
      if (draft.page !== undefined) await saveLanding(ctx.database.pool, draft.page)
      if (draft.sidebar !== undefined) await saveSidebar(ctx.database.pool, draft.sidebar)
      sendJson(response, 200, {
        page: draft.page ?? await loadLanding(ctx.database.pool),
        sidebar: draft.sidebar ?? await loadSidebar(ctx.database.pool),
      })
    },
  })
}

async function* securityRoutes(ctx: HostCtx, secret: string, session: ConsoleSession): AsyncGenerator<() => void> {
  const post = (
    path: string,
    handle: (response: ServerResponse, body: unknown, account: AccountRow) => Promise<void>,
  ): (() => void) => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      const account = await session.read(cookieHeader(request))
      if (account === undefined) {
        sendJson(response, 401, { detail: '未登录' })
        return
      }
      let body: unknown
      try {
        body = await readJson(request)
      } catch (error) {
        void error
        sendJson(response, 400, { detail: '请求无法读取' })
        return
      }
      await handle(response, body, account)
    },
  })

  function answer(
    response: ServerResponse,
    result: { ok: true; body: unknown } | { ok: false; status: number; detail: string },
    cookie?: string,
  ): void {
    if (!result.ok) {
      sendJson(response, result.status, { detail: result.detail })
      return
    }
    sendJson(response, 200, result.body, cookie)
  }

  yield post('/console-api/auth/username', async (response, body, account) => {
    const result = await changeUsername(ctx.database.pool, account.username, field(body, 'username') ?? '')
    const cookie = result.ok && result.body.username !== account.username
      ? sessionCookie(sealSession(result.body.username, secret))
      : undefined
    answer(response, result, cookie)
  })

  yield post('/console-api/auth/password', async (response, body, account) => {
    const result = await changePassword(
      ctx.database.pool,
      account,
      field(body, 'current_password') ?? '',
      field(body, 'new_password') ?? '',
    )
    answer(response, result)
  })

  yield post('/console-api/auth/totp/setup', async (response, _body, account) => {
    answer(response, await beginTotp(ctx.database.pool, account))
  })

  yield post('/console-api/auth/totp/confirm', async (response, body, account) => {
    answer(response, await confirmTotp(ctx.database.pool, account, field(body, 'code') ?? ''))
  })

  yield post('/console-api/auth/totp/disable', async (response, body, account) => {
    answer(response, await disableTotp(
      ctx.database.pool,
      account,
      field(body, 'password') ?? '',
      field(body, 'code') ?? '',
    ))
  })
}
