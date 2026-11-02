import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { GroupRegistry, generalGroup, type Queryable, type Registry } from './service.ts'
import { GroupFailure } from './contract.ts'
import { UNASSIGNED_GROUP_ID } from './rules.ts'

interface SearchHit { header: { id: string }; bestMatch: { snippet: string } }
interface HostCtx extends Context {
  database: { pool: Queryable }
  workspaceRegistry: Registry
  workspaceGroups: GroupRegistry
  consoleSession: { read(cookie: string): Promise<unknown> }
  sessionQuery: {
    listSessions(signal?: AbortSignal): Promise<{ header: { id: string; origin?: string } }[]>
    searchSessions(request: object, exec?: { signal: AbortSignal }): Promise<{ items: SearchHit[]; nextCursor?: string }>
  }
  webServer: { register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }
}

declare module '@deepseek-ai/cordis' { interface Context { workspaceGroups: GroupRegistry } }
export { GroupRegistry as WorkspaceGroups } from './service.ts'
export type { GroupInput } from './rules.ts'
export type { GroupLabelI18n } from './contract.ts'
export const inject = ['database', 'workspaceRegistry', 'webServer', 'consoleSession', 'sessionQuery']
const ROOT = '/console-api/workspace-groups'
const ACTIONS = ['', '/workspaces', '/rename', '/remove', '/focus', '/claim', '/search']

export async function apply(ctx: HostCtx): Promise<void> {
  const groups = new GroupRegistry(ctx.database.pool, ctx.workspaceRegistry, homedir())
  await groups.register(generalGroup)
  ctx.effect(function* () {
    yield () => groups.close()
    for (const action of ACTIONS) yield ctx.webServer.register({ kind: 'exact', path: ROOT + action, handler: (request, response) => handle(ctx, groups, request, response) })
    yield ctx.provide('workspaceGroups', groups)
  })
}

async function handle(ctx: HostCtx, groups: GroupRegistry, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (await ctx.consoleSession.read(cookieOf(request)) === undefined) { send(response, 401, { code: 'auth/required', detail: '未登录' }); return }
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname.slice(ROOT.length)
    if (path === '' && request.method === 'GET') {
      const snapshot = await groups.view()
      send(response, 200, { ...snapshot, ...(process.env.SMP_TEST_HISTORY_EPOCH ? { testResetEpoch: process.env.SMP_TEST_HISTORY_EPOCH } : {}) })
      return
    }
    if (request.method !== 'POST') { send(response, 405, { code: 'request/method', detail: '需要 POST 请求' }); return }
    const body = await readJson(request)
    switch (path) {
      case '/workspaces': send(response, 200, await groups.add(field(body, 'groupId'), field(body, 'path'), optional(body, 'title'))); return
      case '/rename': await groups.rename(field(body, 'workspaceId'), field(body, 'title')); break
      case '/remove': await groups.remove(field(body, 'workspaceId')); break
      case '/focus': await groups.focus(field(body, 'groupId'), optional(body, 'workspaceId') ?? null, field(body, 'sessionId')); break
      case '/claim': await groups.claim(field(body, 'workspaceId'), field(body, 'groupId')); break
      case '/search': send(response, 200, await search(ctx, groups, body, request, response)); return
      default: send(response, 404, { code: 'request/path', detail: '没有这个接口' }); return
    }
    send(response, 200, { ok: true })
  } catch (cause) {
    if (cause instanceof GroupFailure) { send(response, cause.status, { code: cause.code, detail: cause.message, ...(cause.owner === undefined ? {} : { owner: cause.owner }) }); return }
    ctx.logger.warn(cause)
    send(response, 500, { code: 'workspace-group/failed', detail: '操作未完成，请重试' })
  }
}

async function search(ctx: HostCtx, groups: GroupRegistry, body: Record<string, unknown>, request: IncomingMessage, response: ServerResponse): Promise<{ items: { sessionId: string; snippet: string }[]; hasMore: boolean }> {
  const groupId = field(body, 'groupId')
  const query = field(body, 'query')
  if (query.length > 512) throw new GroupFailure('workspace-group/search-query', '搜索词过长')
  const view = await groups.view()
  if (!view.groups.some(g => g.id === groupId)) throw new GroupFailure('workspace-group/unknown', '没有这个工作区组', 404)
  const controller = new AbortController()
  const abort = () => { if (!response.writableEnded) controller.abort() }
  request.on('aborted', abort)
  response.on('close', abort)
  try {
    const records = await ctx.sessionQuery.listSessions(controller.signal)
    const owners = new Map(ctx.workspaceRegistry.list().flatMap(w => w.sessionIds.map(id => [id, w.id] as const)))
    const ids = records.filter(r => {
      if (r.header.origin === 'subagent') return false
      const workspaceId = owners.get(r.header.id)
      return (workspaceId === undefined ? UNASSIGNED_GROUP_ID : view.members.find(m => m.workspaceId === workspaceId)?.groupId) === groupId
    }).map(r => r.header.id)
    if (ids.length === 0) return { items: [], hasMore: false }
    const page = await ctx.sessionQuery.searchSessions({ query, sessionFilters: [{ kind: 'id', values: ids }], eventFilters: [{ kind: 'type', values: ['user/message', 'assistant/message'] }, { kind: 'surface', values: ['current'] }], limit: 50 }, { signal: controller.signal })
    return { items: page.items.map(hit => ({ sessionId: hit.header.id, snippet: hit.bestMatch.snippet })), hasMore: page.nextCursor !== undefined }
  } finally { request.off('aborted', abort); response.off('close', abort) }
}

function cookieOf(request: IncomingMessage): string { const value = request.headers.cookie; return Array.isArray(value) ? value.join('; ') : value ?? '' }
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
    if (size > 65_536) throw new GroupFailure('request/too-large', '请求过大', 413)
    chunks.push(buffer)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (cause) { throw new GroupFailure('request/json', '请求不是有效 JSON', 400, undefined, { cause }) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new GroupFailure('request/json', '请求必须是 JSON 对象')
  return value as Record<string, unknown>
}
function optional(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value == null) return undefined
  if (typeof value !== 'string') throw new GroupFailure('request/field', `${key} 必须是文字`)
  return value.trim()
}
function field(body: Record<string, unknown>, key: string): string {
  const value = optional(body, key)
  if (value === undefined || value === '') throw new GroupFailure('request/field', `缺少 ${key}`)
  return value
}
