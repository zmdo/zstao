import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { checkZone, listDnsRecords } from './cloudflare.ts'
import { normalizeDomain } from './domain-name.ts'
import { queryAudit } from './host/audit.ts'
import { registerDomainTools } from './host/tools.ts'

const PREFIX = '/console-api/domains'

interface Queryable {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>
}

interface HostCtx extends Context {
  database: { pool: Queryable }
  secrets: { encrypt(plaintext: string): string; decrypt(token: string): string }
  consoleSession: { read(cookieHeader: string): Promise<unknown> }
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

interface DomainRow {
  id: string
  name: string
  zone_id: string
  account_id: string
  account_name: string
  status: string
  description: string
  created_at: string
}

export const inject = ['database', 'secrets', 'consoleSession', 'webServer', 'tools']

export async function* apply(ctx: HostCtx): AsyncGenerator<() => void> {
  ctx.inject(['tools'], (scope: Context) => {
    registerDomainTools(scope, { pool: ctx.database.pool, secrets: ctx.secrets })
  })
  yield ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (request, response) => handle(ctx, request, response),
  })
}

async function handle(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if ((await ctx.consoleSession.read(cookieHeader(request))) === undefined) {
    sendJson(response, 401, { code: 'auth_required', detail: '未登录' })
    return
  }
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname.slice(PREFIX.length) || '/'
    if (path === '/' && request.method === 'GET') {
      sendJson(response, 200, { domains: await listDomains(ctx.database.pool) })
      return
    }
    if (path === '/' && request.method === 'POST') {
      await createDomain(ctx, request, response)
      return
    }
    if (path === '/audit' && request.method === 'GET') {
      await readAudit(ctx, request, response)
      return
    }
    const dns = /^\/([0-9a-f-]{36})\/dns$/.exec(path)
    if (dns !== null && request.method === 'GET') {
      await readDns(ctx, dns[1], response)
      return
    }
    const one = /^\/([0-9a-f-]{36})$/.exec(path)
    if (one !== null && request.method === 'PATCH') {
      await updateDomain(ctx, one[1], request, response)
      return
    }
    if (one !== null && request.method === 'DELETE') {
      await ctx.database.pool.query('delete from domain_manager_domains where id = $1', [one[1]])
      response.writeHead(204, { 'cache-control': 'no-store' })
      response.end()
      return
    }
    sendJson(response, 404, { code: 'not_found', detail: '没有这个接口' })
  } catch (cause) {
    sendJson(response, 500, { code: 'internal', detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

async function listDomains(pool: Queryable): Promise<unknown[]> {
  const { rows } = await pool.query<DomainRow>(
    'select id, name, zone_id, account_id, account_name, status, description, created_at from domain_manager_domains order by created_at asc, name asc',
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    zoneId: row.zone_id,
    accountId: row.account_id,
    accountName: row.account_name,
    status: row.status,
    description: row.description,
    createdAt: row.created_at,
  }))
}

async function createDomain(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body: unknown
  try {
    body = await readJson(request)
  } catch {
    sendJson(response, 400, { code: 'bad_request', detail: '请求无法读取' })
    return
  }
  const rawName = field(body, 'name')?.trim() ?? ''
  const accountId = field(body, 'accountId')?.trim() ?? ''
  const token = field(body, 'token')?.trim() ?? ''
  const description = field(body, 'description')?.trim() ?? ''
  const name = normalizeDomain(rawName)
  if (name === undefined) {
    sendJson(response, 400, { code: 'invalid_domain', detail: '域名格式不正确' })
    return
  }
  if (description.length > 200) {
    sendJson(response, 400, { code: 'invalid_description', detail: '说明最多 200 个字符' })
    return
  }
  if (!/^[0-9a-fA-F]{32}$/.test(accountId)) {
    sendJson(response, 400, { code: 'invalid_account_id', detail: 'Cloudflare 账户 ID 是 32 位十六进制' })
    return
  }
  if (token === '') {
    sendJson(response, 400, { code: 'invalid_token', detail: '需要 Cloudflare API 令牌' })
    return
  }
  const existing = await ctx.database.pool.query<{ id: string }>('select id from domain_manager_domains where name = $1', [name])
  if (existing.rows.length > 0) {
    sendJson(response, 409, { code: 'duplicate', detail: '该域名已经在列表里' })
    return
  }
  const checked = await checkZone(token, name, accountId.toLowerCase())
  if (!checked.ok) {
    sendJson(response, 400, { code: checked.code, detail: checked.detail })
    return
  }
  const id = randomUUID()
  const ciphertext = ctx.secrets.encrypt(token)
  const { rows } = await ctx.database.pool.query<DomainRow>(
    `insert into domain_manager_domains (id, name, zone_id, account_id, account_name, status, token_ciphertext, description)
     values ($1, $2, $3, $4, $5, 'active', $6, $7)
     returning id, name, zone_id, account_id, account_name, status, description, created_at`,
    [id, name, checked.zone.id, checked.zone.accountId, checked.zone.accountName, ciphertext, description],
  )
  const row = rows[0]
  sendJson(response, 201, {
    domain: {
      id: row.id,
      name: row.name,
      zoneId: row.zone_id,
      accountId: row.account_id,
      accountName: row.account_name,
      status: row.status,
      description: row.description,
      createdAt: row.created_at,
    },
  })
}

async function updateDomain(ctx: HostCtx, id: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body: unknown
  try {
    body = await readJson(request)
  } catch {
    sendJson(response, 400, { code: 'bad_request', detail: '请求无法读取' })
    return
  }
  const description = field(body, 'description')
  if (description === undefined) {
    sendJson(response, 400, { code: 'invalid_argument', detail: '需要 description 字段' })
    return
  }
  const text = description.trim()
  if (text.length > 200) {
    sendJson(response, 400, { code: 'invalid_description', detail: '说明最多 200 个字符' })
    return
  }
  const { rows } = await ctx.database.pool.query<DomainRow>(
    `update domain_manager_domains set description = $2 where id = $1
     returning id, name, zone_id, account_id, account_name, status, description, created_at`,
    [id, text],
  )
  const row = rows[0]
  if (row === undefined) {
    sendJson(response, 404, { code: 'not_found', detail: '域名不存在' })
    return
  }
  sendJson(response, 200, {
    domain: {
      id: row.id,
      name: row.name,
      zoneId: row.zone_id,
      accountId: row.account_id,
      accountName: row.account_name,
      status: row.status,
      description: row.description,
      createdAt: row.created_at,
    },
  })
}

async function readDns(ctx: HostCtx, id: string, response: ServerResponse): Promise<void> {
  const { rows } = await ctx.database.pool.query<DomainRow & { token_ciphertext: string }>(
    'select id, name, zone_id, account_id, account_name, status, description, created_at, token_ciphertext from domain_manager_domains where id = $1',
    [id],
  )
  const row = rows[0]
  if (row === undefined) {
    sendJson(response, 404, { code: 'not_found', detail: '域名不存在' })
    return
  }
  try {
    const page = await listDnsRecords(ctx.secrets.decrypt(row.token_ciphertext), row.zone_id, { perPage: 100 })
    sendJson(response, 200, {
      domain: { id: row.id, name: row.name, zoneId: row.zone_id, accountId: row.account_id, accountName: row.account_name, status: row.status, description: row.description, createdAt: row.created_at },
      records: page.records,
      total: page.total,
      totalPages: page.totalPages,
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (message === 'dns_read_forbidden') {
      sendJson(response, 403, { code: 'dns_read_forbidden', detail: '令牌没有读取 DNS 的权限' })
      return
    }
    sendJson(response, 502, { code: 'cloudflare', detail: message })
  }
}

async function readAudit(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1)
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('page_size') ?? 20) || 20, 1), 100)
  const tool = (url.searchParams.get('tool') ?? '').trim()
  const domain = (url.searchParams.get('domain') ?? '').trim()
  const hoursRaw = (url.searchParams.get('hours') ?? '').trim()
  const hours = hoursRaw === '' ? undefined : Number(hoursRaw)
  const result = await queryAudit(ctx.database.pool, {
    page,
    pageSize,
    tool,
    domain,
    hours: hours === undefined || Number.isNaN(hours) ? undefined : hours,
  })
  sendJson(response, 200, result)
}

function cookieHeader(request: IncomingMessage): string {
  const value = request.headers.cookie
  return Array.isArray(value) ? value.join('; ') : value ?? ''
}

function field(body: unknown, name: string): string | undefined {
  if (body === null || typeof body !== 'object' || !(name in body)) return undefined
  const value = (body as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 65_536) throw new Error('body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
