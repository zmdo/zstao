import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { readPatch, writePatch } from './files.ts'
import { encryptionKeyError } from './key.ts'
import { encryptionKey, writeEncryptionKey } from './patch.ts'

interface SessionService {
  read(cookieHeader: string): Promise<unknown>
}

interface ProfileFacts {
  patchPath: string
}

interface HostCtx extends Context {
  profileContext: ProfileFacts
  consoleSession: SessionService
  secrets: { replaceKey(encoded: string): void }
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

export const inject = ['webServer', 'consoleSession', 'profileContext', 'secrets']

/** The data tab reads and replaces the store plugin's encryption key. */
export async function* apply(ctx: HostCtx): AsyncGenerator<() => void> {
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/data/key',
    handler: (request, response) => keyRoute(ctx, request, response),
  })
}

async function keyRoute(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (await ctx.consoleSession.read(cookieHeader(request)) === undefined) {
    sendJson(response, 401, { detail: '未登录' })
    return
  }
  if (request.method === 'GET') {
    const current = encryptionKey(await readPatch(ctx.profileContext.patchPath))
    if (current === undefined) {
      sendJson(response, 500, { detail: '存储配置不在' })
      return
    }
    sendJson(response, 200, { encryptionKey: current })
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
  } catch (cause) {
    void cause
    sendJson(response, 400, { detail: '请求无法读取' })
    return
  }
  const next = field(body, 'encryptionKey')?.trim() ?? ''
  const keyError = encryptionKeyError(next)
  if (keyError !== undefined) {
    sendJson(response, 400, { detail: keyError })
    return
  }
  const path = ctx.profileContext.patchPath
  const previous = await readPatch(path)
  const written = writeEncryptionKey(previous, next)
  if (written === undefined) {
    sendJson(response, 500, { detail: '存储配置不在' })
    return
  }
  await writePatch(path, written)
  try {
    ctx.secrets.replaceKey(next)
  } catch (cause) {
    void cause
    await writePatch(path, previous)
    sendJson(response, 500, { detail: '密钥没有换上' })
    return
  }
  sendJson(response, 200, { ok: true })
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
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}
