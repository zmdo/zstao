import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError, OneDev, commitSha, decryptPassword, imageType, preview, projectId, repositoryPath } from './onedev.ts'
import type { Secrets } from './onedev.ts'
import { API, DOWNLOAD_BYTES } from './shared.ts'

interface HostCtx {
  consoleSession: { read(cookieHeader: string): Promise<unknown> }
  secrets: Secrets
  webServer: { register(route: { kind: 'prefix'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }
  effect(run: () => (() => void | Promise<void>)): void
}
interface Settings { internalBaseUrl: string; externalBaseUrl: string; username: string; passwordCiphertext: string; updatedAt: string | null }
export const inject = ['consoleSession', 'secrets', 'webServer']

export function apply(ctx: HostCtx): void {
  const file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'project-management.json')
  ctx.effect(() => {
    const shutdown = new AbortController()
    const pending = new Set<Promise<void>>()
    let reveals: number[] = []
    const stop = ctx.webServer.register({ kind: 'prefix', path: API, handler(request, response) {
      const disconnected = new AbortController()
      const close = () => disconnected.abort()
      response.on('close', close)
      const signal = AbortSignal.any([shutdown.signal, disconnected.signal])
      const task = handle(ctx, file, request, response, signal, () => {
        const now = Date.now()
        reveals = reveals.filter(at => now - at < 60_000)
        if (reveals.length >= 10) throw new ApiError(429, 'rate_limited')
        reveals.push(now)
      }).finally(() => { pending.delete(task); response.off('close', close) })
      pending.add(task)
      return task
    } })
    return async () => {
      stop()
      shutdown.abort()
      await Promise.allSettled([...pending])
    }
  })
}

async function readSettings(file: string): Promise<Settings> {
  let content: string
  try { content = await readFile(file, 'utf8') } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return { internalBaseUrl: 'http://10.2.8.9', externalBaseUrl: 'http://10.2.8.9', username: 'admin', passwordCiphertext: '', updatedAt: null }
    throw new ApiError(500, 'settings_unavailable', { cause })
  }
  let value: unknown
  try { value = JSON.parse(content) } catch (cause) { throw new ApiError(500, 'settings_unavailable', { cause }) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(500, 'settings_unavailable')
  const row = value as Record<string, unknown>
  const internal = typeof row.internalBaseUrl === 'string' ? row.internalBaseUrl : typeof row.baseUrl === 'string' ? row.baseUrl : ''
  if (!internal || typeof row.username !== 'string' || typeof row.passwordCiphertext !== 'string') throw new ApiError(500, 'settings_unavailable')
  return { internalBaseUrl: normalizeBaseUrl(internal), externalBaseUrl: normalizeBaseUrl(typeof row.externalBaseUrl === 'string' && row.externalBaseUrl ? row.externalBaseUrl : internal), username: row.username,
    passwordCiphertext: row.passwordCiphertext, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null }
}
function publicSettings(settings: Settings) {
  return { internalBaseUrl: settings.internalBaseUrl, externalBaseUrl: settings.externalBaseUrl, username: settings.username, configured: settings.passwordCiphertext !== '', updatedAt: settings.updatedAt }
}
function sameOriginJson(request: IncomingMessage): void {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new ApiError(415, 'json_required')
  const site = request.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new ApiError(403, 'origin_rejected')
  const origin = request.headers.origin
  if (origin !== undefined) {
    let parsed: URL
    try { parsed = new URL(origin) } catch (cause) { throw new ApiError(403, 'origin_rejected', { cause }) }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== request.headers.host) throw new ApiError(403, 'origin_rejected')
  }
}
async function handle(ctx: HostCtx, file: string, request: IncomingMessage, response: ServerResponse, signal: AbortSignal, reveal: () => void): Promise<void> {
  try {
    const cookie = request.headers.cookie
    if (await ctx.consoleSession.read(Array.isArray(cookie) ? cookie.join('; ') : cookie ?? '') === undefined) throw new ApiError(401, 'auth_required')
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${API}/`)) throw new ApiError(404, 'not_found')
    const path = url.pathname.slice(API.length)
    if (path === '/settings') {
      if (request.method === 'GET') { send(response, 200, publicSettings(await readSettings(file))); return }
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
      sameOriginJson(request)
      const body = await readJson(request)
      const internalBaseUrl = normalizeBaseUrl(typeof body.internalBaseUrl === 'string' ? body.internalBaseUrl : typeof body.baseUrl === 'string' ? body.baseUrl : '')
      const externalBaseUrl = normalizeBaseUrl(typeof body.externalBaseUrl === 'string' && body.externalBaseUrl.trim() ? body.externalBaseUrl : internalBaseUrl)
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      if (!username || username.includes(':') || /[\r\n]/.test(username)) throw new ApiError(400, 'invalid_username')
      const previous = await readSettings(file)
      const password = typeof body.password === 'string' ? body.password : ''
      const passwordCiphertext = password === '' ? previous.passwordCiphertext : ctx.secrets.encrypt(password)
      if (!passwordCiphertext) throw new ApiError(400, 'password_required')
      const next = { internalBaseUrl, externalBaseUrl, username, passwordCiphertext, updatedAt: new Date().toISOString() }
      await mkdir(dirname(file), { recursive: true })
      const temporary = join(dirname(file), `.project-management-${randomUUID()}.json`)
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, file)
      send(response, 200, publicSettings(next))
      return
    }
    if (path === '/settings/reveal-password') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
      sameOriginJson(request)
      reveal()
      const settings = await readSettings(file)
      send(response, 200, { password: decryptPassword(settings, ctx.secrets) })
      return
    }
    if (path === '/test') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
    } else if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
    const one = new OneDev(await readSettings(file), ctx.secrets, signal)
    if (path === '/projects' || path === '/test') {
      const raw = url.searchParams.get('offset') ?? '0'
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 1_000_000) throw new ApiError(400, 'invalid_offset')
      const offset = Number(raw)
      const projects = await one.projects(offset)
      if (path === '/test') { send(response, 200, { ok: true, projectCount: projects.length }); return }
      send(response, 200, { projects, nextOffset: projects.length === 100 ? offset + projects.length : null })
      return
    }
    const match = /^\/repos\/([1-9]\d*)(?:\/(resolve|tree|file|asset|raw|commits))?$/.exec(path)
    if (!match) throw new ApiError(404, 'not_found')
    const id = projectId(match[1])
    if (!match[2]) { send(response, 200, await one.repository(id)); return }
    if (match[2] === 'resolve') {
      const type = url.searchParams.get('type')
      if (type !== 'branch' && type !== 'tag') throw new ApiError(400, 'invalid_revision')
      send(response, 200, { sha: await one.resolve(id, type, url.searchParams.get('name') ?? '') })
      return
    }
    const sha = commitSha(url.searchParams.get('sha') ?? '')
    const repositoryFile = repositoryPath(url.searchParams.get('path') ?? '', match[2] === 'tree' || match[2] === 'commits')
    if (match[2] === 'tree') { send(response, 200, await one.tree(id, sha, repositoryFile)); return }
    if (match[2] === 'commits') { send(response, 200, await one.commits(id, sha)); return }
    const blob = await one.file(id, sha, repositoryFile)
    if (match[2] === 'file') { send(response, 200, preview(blob)); return }
    if (blob.partial || blob.size > DOWNLOAD_BYTES) throw new ApiError(413, 'download_too_large')
    const mime = match[2] === 'asset' ? imageType(blob.bytes) : 'application/octet-stream'
    if (!mime) throw new ApiError(415, 'unsupported_image')
    if (response.destroyed || signal.aborted) return
    response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox", 'content-length': blob.bytes.length,
      ...(match[2] === 'raw' ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(repositoryFile.split('/').at(-1) ?? 'download').replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}` } : {}) })
    response.end(blob.bytes)
  } catch (cause) {
    if (signal.aborted) return
    const failure = cause instanceof ApiError ? cause : new ApiError(500, 'request_failed', { cause })
    send(response, failure.status, { code: failure.code })
  }
}
function normalizeBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch (cause) { throw new ApiError(400, 'invalid_url', { cause }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ApiError(400, 'invalid_url')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}
function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(body))
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new ApiError(413, 'request_too_large')
    chunks.push(buffer)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (cause) { throw new ApiError(400, 'invalid_json', { cause }) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, 'invalid_json')
  return value as Record<string, unknown>
}
