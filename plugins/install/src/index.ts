import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  ensureDisabled,
  markerExists,
  readPatch,
  reloadStore,
  removeMarker,
  saveCredentials,
  storeCredentials,
  writeMarker,
  writePatch,
  type ProfileFacts,
} from './files.ts'
import { encryptionKeyError } from './key.ts'
import { INSTALL_PAGE } from './page.ts'
import { databaseReachable } from './probe.ts'
import { composeDatabaseUrl } from './url.ts'

interface IndexRequest {
  method?: string
  url?: string
  headers: { cookie?: string | string[] }
}

interface IndexResponse {
  writeHead(status: number, headers?: Record<string, string | readonly string[]>): unknown
  end(body?: string): unknown
}

interface ConnectionService {
  authorizeIndex(request: IndexRequest, response: IndexResponse): boolean
}

interface HostCtx extends Context {
  profileContext: ProfileFacts
  connection: ConnectionService
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

export const inject = ['webServer', 'profileContext', 'connection']

/**
 * The marker file is the lock. A profile that already has it never serves
 * the install page, even when the database settings are gone.
 * Registration stays inside this generator so the routes live with the plugin.
 */
export async function* apply(ctx: HostCtx): AsyncGenerator<() => void> {
  const profile = ctx.profileContext
  if (await markerExists(profile.dir)) {
    await ensureDisabled(profile.patchPath)
    return
  }
  const existing = storeCredentials(await readPatch(profile.patchPath))
  if (existing !== undefined && encryptionKeyError(existing.encryptionKey) === undefined) {
    const failure = await databaseReachable(existing.databaseUrl)
    if (failure === undefined) {
      await writeMarker(profile.dir)
      await ensureDisabled(profile.patchPath)
      return
    }
  }
  const gate = holdIndex(ctx.connection)
  gate.hold()
  yield () => {
    gate.release()
  }
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/install',
    handler: (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(request.method === 'HEAD' ? undefined : INSTALL_PAGE)
    },
  })
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/install/probe',
    handler: (request, response) => probe(request, response),
  })
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/install',
    handler: (request, response) => submit(ctx, gate, request, response),
  })
}

/** Check the database fields without writing them. The install button stays off until this succeeds. */
async function probe(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
    response.end()
    return
  }
  const body = await readBody(request, response)
  if (body === undefined) return
  const composed = composeDatabaseUrl(databaseParts(body))
  if (!composed.ok) {
    sendJson(response, 400, { ok: false, detail: composed.detail })
    return
  }
  const databaseError = await databaseReachable(composed.url)
  if (databaseError !== undefined) {
    sendJson(response, 400, { ok: false, detail: databaseError })
    return
  }
  sendJson(response, 200, { ok: true })
}

async function submit(
  ctx: HostCtx,
  gate: IndexGate,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
    response.end()
    return
  }
  const body = await readBody(request, response)
  if (body === undefined) return
  const composed = composeDatabaseUrl(databaseParts(body))
  if (!composed.ok) {
    sendJson(response, 400, { ok: false, detail: composed.detail })
    return
  }
  const databaseUrl = composed.url
  const encryptionKey = field(body, 'encryptionKey')?.trim() ?? ''
  const keyError = encryptionKeyError(encryptionKey)
  if (keyError !== undefined) {
    sendJson(response, 400, { ok: false, detail: keyError })
    return
  }
  const databaseError = await databaseReachable(databaseUrl)
  if (databaseError !== undefined) {
    sendJson(response, 400, { ok: false, detail: databaseError })
    return
  }
  const profile = ctx.profileContext
  const previous = await saveCredentials(profile.patchPath, { databaseUrl, encryptionKey })
  await writeMarker(profile.dir)
  gate.release()
  try {
    await reloadStore(ctx, profile)
  } catch (cause) {
    void cause
    await writePatch(profile.patchPath, previous)
    await removeMarker(profile.dir)
    gate.hold()
    sendJson(response, 500, { ok: false, detail: '存储插件没有加载起来' })
    return
  }
  sendJson(response, 200, { ok: true })
}

interface IndexGate {
  hold(): void
  release(): void
}

function holdIndex(connection: ConnectionService): IndexGate {
  const original = connection.authorizeIndex.bind(connection)
  const redirect: ConnectionService['authorizeIndex'] = (_request, response) => {
    response.writeHead(303, { location: '/install', 'cache-control': 'no-store' })
    response.end()
    return false
  }
  let armed = false
  return {
    hold() {
      armed = true
      connection.authorizeIndex = redirect
    },
    release() {
      if (!armed) return
      armed = false
      connection.authorizeIndex = original
    },
  }
}

function databaseParts(body: unknown): { host: string, port: string, database: string, username: string, password: string } {
  return {
    host: field(body, 'host') ?? '',
    port: field(body, 'port') ?? '',
    database: field(body, 'database') ?? '',
    username: field(body, 'username') ?? '',
    password: field(body, 'password') ?? '',
  }
}

async function readBody(request: IncomingMessage, response: ServerResponse): Promise<unknown> {
  try {
    return await readJson(request)
  } catch (cause) {
    void cause
    sendJson(response, 400, { ok: false, detail: '请求无法读取' })
    return undefined
  }
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
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}
