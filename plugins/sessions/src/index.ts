import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { releaseLiveSession } from './live.ts'
import { sessionIdError } from './query.ts'
import { removeArchivedSession } from './remove.ts'

interface SessionService {
  read(cookieHeader: string): Promise<unknown>
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>
}

interface WorkspaceRecord {
  sessionIds: readonly string[]
  detachSession(sessionId: string): Promise<void>
}

interface HostCtx extends Context {
  consoleSession: SessionService
  database: { pool: Queryable }
  workspaceRegistry: {
    archivedSessionIds: readonly string[]
    list(): WorkspaceRecord[]
    unarchiveSession(sessionId: string): Promise<void>
  }
  sessions: { get(id: string): unknown }
  agents: { get(id: string): { status?: string } | undefined }
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

export const inject = ['webServer', 'consoleSession', 'database', 'workspaceRegistry', 'sessions', 'agents']

/** Delete is the only host route. Listing, search, open, and restore stay on the client. */
export async function* apply(ctx: HostCtx): AsyncGenerator<() => void> {
  yield ctx.webServer.register({
    kind: 'exact',
    path: '/console-api/sessions/delete',
    handler: (request, response) => deleteRoute(ctx, request, response),
  })
}

async function deleteRoute(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (await ctx.consoleSession.read(cookieHeader(request)) === undefined) {
    sendJson(response, 401, { detail: '未登录' })
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
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
  const id = field(body, 'sessionId')?.trim() ?? ''
  const idError = sessionIdError(id)
  if (idError !== undefined) {
    sendJson(response, 400, { detail: idError })
    return
  }
  const result = await removeArchivedSession({
    archived: (sessionId) => ctx.workspaceRegistry.archivedSessionIds.includes(sessionId),
    running: (sessionId) => ctx.agents.get(sessionId)?.status === 'running',
    live: (sessionId) => ctx.sessions.get(sessionId) !== undefined || ctx.agents.get(sessionId) !== undefined,
    release: (sessionId) => releaseLiveSession(ctx.root, sessionId),
    detach: async (sessionId) => {
      const owners = ctx.workspaceRegistry.list().filter((workspace) => workspace.sessionIds.includes(sessionId))
      for (const workspace of owners) await workspace.detachSession(sessionId)
    },
    unarchive: (sessionId) => ctx.workspaceRegistry.unarchiveSession(sessionId),
    erase: (sessionId) => eraseSession(ctx.database.pool, sessionId),
  }, id)
  if (!result.ok) {
    sendJson(response, result.status, { detail: result.detail })
    return
  }
  sendJson(response, 200, { ok: true })
}

async function eraseSession(pool: Queryable, id: string): Promise<void> {
  await pool.query('delete from console_session_event where session_id = $1', [id])
  await pool.query('delete from console_session where id = $1', [id])
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
