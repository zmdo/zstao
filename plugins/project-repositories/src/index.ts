import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface SessionService {
  read(cookieHeader: string): Promise<unknown>
}

interface SecretsService {
  encrypt(value: string): string
  decrypt(value: string): string
}

interface WebServer {
  register(route: {
    kind: 'exact'
    path: string
    handler(request: IncomingMessage, response: ServerResponse): Promise<void>
  }): () => void
}

interface HostCtx {
  consoleSession: SessionService
  secrets: SecretsService
  webServer: WebServer
  effect(run: () => (() => void)): void
  logger: { warn(error: unknown): void }
}

export const inject = ['consoleSession', 'secrets', 'webServer']

const ROOT = '/console-api/project-management'

export function apply(ctx: HostCtx): void {
  const settingsFile = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'project-management.json')
  ctx.effect(() => {
    const stops = [
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/settings`, handler: (request, response) => settingsRoute(ctx, settingsFile, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/test`, handler: (request, response) => testRoute(ctx, settingsFile, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/projects`, handler: (request, response) => projectsRoute(ctx, settingsFile, request, response) }),
    ]
    return () => { for (const stop of stops) stop() }
  })
}

interface Settings {
  internalBaseUrl: string
  externalBaseUrl: string
  username: string
  passwordCiphertext: string
  updatedAt: string | null
}

interface OneDevProject {
  id: number
  name: string
  path: string
  description?: string | null
  codeManagement?: boolean
  issueManagement?: boolean
  packManagement?: boolean
  createDate?: string
}

async function readSettings(file: string): Promise<Settings> {
  const fallback: Settings = {
    internalBaseUrl: 'http://10.2.8.9',
    externalBaseUrl: 'http://10.2.8.9',
    username: 'admin',
    passwordCiphertext: '',
    updatedAt: null,
  }
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<Settings> & { baseUrl?: string }
    const internal = typeof raw.internalBaseUrl === 'string' && raw.internalBaseUrl !== ''
      ? raw.internalBaseUrl
      : typeof raw.baseUrl === 'string' && raw.baseUrl !== '' ? raw.baseUrl : fallback.internalBaseUrl
    return {
      internalBaseUrl: internal,
      externalBaseUrl: typeof raw.externalBaseUrl === 'string' && raw.externalBaseUrl !== '' ? raw.externalBaseUrl : internal,
      username: typeof raw.username === 'string' && raw.username !== '' ? raw.username : fallback.username,
      passwordCiphertext: typeof raw.passwordCiphertext === 'string' ? raw.passwordCiphertext : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    }
  } catch {
    return fallback
  }
}

function publicSettings(settings: Settings): Record<string, unknown> {
  return {
    internalBaseUrl: settings.internalBaseUrl,
    externalBaseUrl: settings.externalBaseUrl,
    username: settings.username,
    configured: settings.passwordCiphertext !== '',
    updatedAt: settings.updatedAt,
  }
}

async function settingsRoute(ctx: HostCtx, file: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method === 'GET') {
    send(response, 200, publicSettings(await readSettings(file)))
    return
  }
  if (request.method !== 'POST') { send(response, 405, { detail: '需要 GET 或 POST' }); return }
  try {
    const body = await readJson(request)
    const rawInternal = typeof body.internalBaseUrl === 'string' ? body.internalBaseUrl : body.baseUrl
    const internalBaseUrl = normalizeBaseUrl(typeof rawInternal === 'string' ? rawInternal : '', '内部访问地址')
    const rawExternal = typeof body.externalBaseUrl === 'string' ? body.externalBaseUrl.trim() : ''
    const externalBaseUrl = rawExternal === '' ? internalBaseUrl : normalizeBaseUrl(rawExternal, '外部访问地址')
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (username === '') throw new Error('用户名不能为空')
    const previous = await readSettings(file)
    const password = typeof body.password === 'string' ? body.password : ''
    const passwordCiphertext = password === '' ? previous.passwordCiphertext : ctx.secrets.encrypt(password)
    if (passwordCiphertext === '') throw new Error('首次配置必须填写 OneDev 密码')
    await mkdir(dirname(file), { recursive: true })
    const next: Settings = { internalBaseUrl, externalBaseUrl, username, passwordCiphertext, updatedAt: new Date().toISOString() }
    const temporary = join(dirname(file), `.project-management-${randomUUID()}.json`)
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
    send(response, 200, publicSettings(next))
  } catch (cause) {
    send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

async function testRoute(ctx: HostCtx, file: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'POST') { send(response, 405, { detail: '需要 POST' }); return }
  try {
    const settings = await readSettings(file)
    const projects = await listProjects(ctx, settings)
    send(response, 200, { ok: true, projectCount: projects.length })
  } catch (cause) {
    send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

async function projectsRoute(ctx: HostCtx, file: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { detail: '需要 GET' }); return }
  try {
    const settings = await readSettings(file)
    const projects = await listProjects(ctx, settings)
    send(response, 200, {
      internalBaseUrl: settings.internalBaseUrl,
      externalBaseUrl: settings.externalBaseUrl,
      configured: settings.passwordCiphertext !== '',
      projects: projects.map(project => ({
        id: project.id,
        name: project.name,
        path: project.path,
        description: project.description ?? '',
        codeManagement: project.codeManagement === true,
        issueManagement: project.issueManagement === true,
        packManagement: project.packManagement === true,
        webUrl: `${settings.externalBaseUrl}/projects/${project.path.split('/').map(encodeURIComponent).join('/')}`,
        createDate: project.createDate ?? '',
      })),
    })
  } catch (cause) {
    send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

async function listProjects(ctx: HostCtx, settings: Settings): Promise<OneDevProject[]> {
  if (settings.passwordCiphertext === '') throw new Error('OneDev 尚未配置密码')
  let password: string
  try {
    password = ctx.secrets.decrypt(settings.passwordCiphertext)
  } catch {
    throw new Error('OneDev 凭据无法解密，请重新保存配置')
  }
  const authorization = `Basic ${Buffer.from(`${settings.username}:${password}`).toString('base64')}`
  let response: globalThis.Response
  try {
    response = await fetch(`${settings.internalBaseUrl}/~api/projects?offset=0&count=100`, {
      headers: { accept: 'application/json', authorization },
      signal: AbortSignal.timeout(12_000),
    })
  } catch (cause) {
    throw new Error(`无法连接 OneDev：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`OneDev 返回 HTTP ${response.status}：${detail}`)
  }
  const value: unknown = await response.json()
  if (!Array.isArray(value)) throw new Error('OneDev 项目列表格式不正确')
  return value as OneDevProject[]
}

function normalizeBaseUrl(value: string, label: string): string {
  const input = value.trim()
  if (input === '') throw new Error(`${label}不能为空`)
  let url: URL
  try { url = new URL(input) } catch { throw new Error(`${label}不是合法 URL`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${label}只支持 HTTP 或 HTTPS`)
  if (url.username !== '' || url.password !== '') throw new Error(`${label}不能包含用户名或密码`)
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

async function authorized(ctx: HostCtx, request: IncomingMessage): Promise<boolean> {
  const cookie = request.headers.cookie
  return await ctx.consoleSession.read(Array.isArray(cookie) ? cookie.join('; ') : cookie ?? '') !== undefined
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new Error('请求过大')
    chunks.push(buffer)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('请求必须是 JSON 对象')
  return value as Record<string, unknown>
}
