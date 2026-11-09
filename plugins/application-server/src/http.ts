import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Db } from '@smp/console-server-management/contracts'
import { inScope, RegistryError, RegistryManager, repositoryOf, uuid } from './registry.ts'

export const API = '/console-api/application-registry'
interface Client { id: string; name: string; server_ids: string[]; repositories: string[] }
interface Context { consoleSession: { read(cookie: string): Promise<unknown> } }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex') }
function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RegistryError('json_required', 415)
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) { size += chunk.length; if (size > 16384) throw new RegistryError('body_too_large', 413); chunks.push(Buffer.from(chunk)) }
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (value && typeof value === 'object' && !Array.isArray(value)) return value } catch {}
  throw new RegistryError('invalid_request', 400)
}
function origin(request: IncomingMessage): void {
  if (request.headers['sec-fetch-site'] && !['same-origin','none'].includes(String(request.headers['sec-fetch-site']))) throw new RegistryError('origin_rejected', 403)
  if (request.headers.origin) {
    let value: URL
    try { value = new URL(request.headers.origin) } catch { throw new RegistryError('origin_rejected', 403) }
    if (!['http:','https:'].includes(value.protocol) || value.host !== request.headers.host) throw new RegistryError('origin_rejected', 403)
  }
}
function scopes(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.length > 100 || input.some(value => typeof value !== 'string' || !/^[a-z0-9]+(?:[.:-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?:\/\*)?$/.test(value))) throw new RegistryError('invalid_repository_scope', 400)
  return [...new Set(input as string[])].sort()
}
export function registryHandler(context: Context, db: Db, manager: RegistryManager) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    request.setTimeout(30_000, () => request.destroy())
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname.slice(API.length)
      if (path === '/prepare' || path.startsWith('/requests/')) {
        // CI never authenticates with a browser cookie. The bearer only permits scoped preparation and deployment.
        const auth = /^Bearer (ces_[a-zA-Z0-9_-]{43})$/.exec(request.headers.authorization ?? '')
        if (!auth) throw new RegistryError('service_auth_required', 401)
        const client = (await db.query<Client>('select id,name,server_ids,repositories from application_registry_clients where token_hash=$1', [tokenHash(auth[1]!)])).rows[0]
        if (!client) throw new RegistryError('service_auth_required', 401)
        if (path === '/prepare' && request.method === 'POST') {
          const input = await body(request)
          if (!uuid(input.serverId) || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/.test(input.requestId) || typeof input.credentialId !== 'string') throw new RegistryError('invalid_request', 400)
          const image = repositoryOf(input.image)
          if (!client.server_ids.includes(input.serverId) || !inScope(`${image.registry}/${image.repository}`, client.repositories)) throw new RegistryError('deployment_scope_denied', 403)
          const previous = (await db.query<{ server_identity: string; image: string; job_id: string }>('select server_identity,image,job_id from application_registry_requests where client_id=$1 and request_id=$2', [client.id, input.requestId])).rows[0]
          if (previous && (previous.server_identity !== input.serverId || previous.image !== input.image)) throw new RegistryError('idempotency_conflict')
          const task = previous ? await manager.jobs.configurationTask(previous.job_id) : await manager.prepare(input.serverId, String(input.image), input.credentialId, `client:${client.id}:${input.requestId}`)
          if (!task) throw new RegistryError('task_not_found', 404)
          await db.query('insert into application_registry_requests(client_id,request_id,server_identity,image,job_id) values($1,$2,$3,$4,$5) on conflict(client_id,request_id) do nothing', [client.id, input.requestId, input.serverId, input.image, task.id])
          // A concurrent duplicate must agree on every field, not only the registry version.
          const stored = (await db.query<{ image: string; server_identity: string }>('select image,server_identity from application_registry_requests where client_id=$1 and request_id=$2', [client.id, input.requestId])).rows[0]!
          if (stored.image !== input.image || stored.server_identity !== input.serverId) throw new RegistryError('idempotency_conflict')
          send(response, 202, { requestId: input.requestId, taskId: task.id, state: task.state }); return
        }
        if (path.startsWith('/requests/') && path.endsWith('/deploy') && ['POST','GET'].includes(request.method ?? '')) {
          const requestId = path.slice('/requests/'.length, -'/deploy'.length)
          const record = (await db.query<{ server_identity: string; image: string; job_id: string; deployment_job_id: string | null }>('select server_identity,image,job_id,deployment_job_id from application_registry_requests where client_id=$1 and request_id=$2', [client.id, requestId])).rows[0]
          if (!record) throw new RegistryError('task_not_found', 404)
          const image = repositoryOf(record.image)
          if (!client.server_ids.includes(record.server_identity) || !inScope(`${image.registry}/${image.repository}`, client.repositories)) throw new RegistryError('deployment_scope_denied', 403)
          if (request.method === 'GET') {
            const task = record.deployment_job_id ? await manager.jobs.configurationTask(record.deployment_job_id) : undefined
            if (!task) throw new RegistryError('task_not_found', 404)
            if (['succeeded','failed','blocked','cancelled'].includes(task.state)) await db.query('update application_registry_requests set pull_result=$3,reported_at=coalesce(reported_at,now()) where client_id=$1 and request_id=$2', [client.id, requestId, JSON.stringify({ ...(task.result as object ?? {}), image: record.image, reportedBy: 'managed-server-job' })])
            send(response, 200, task); return
          }
          await body(request)
          const prepared = await manager.jobs.configurationTask(record.job_id)
          const receipt = (prepared?.result as { receipt?: import('@smp/console-server-management/contracts').Json } | null)?.receipt
          if (prepared?.state !== 'succeeded' || !receipt) throw new RegistryError('credential_preparation_required')
          const task = record.deployment_job_id ? await manager.jobs.configurationTask(record.deployment_job_id) : await manager.deploy(record.server_identity, record.image, receipt, `deploy:${client.id}:${requestId}`)
          if (!task) throw new RegistryError('task_not_found', 404)
          await db.query('update application_registry_requests set deployment_job_id=$3 where client_id=$1 and request_id=$2', [client.id, requestId, task.id])
          send(response, 202, task); return
        }
        if (path.startsWith('/requests/') && request.method === 'GET') {
          const requestId = path.slice('/requests/'.length)
          const record = (await db.query<{ server_identity: string; image: string; job_id: string }>('select server_identity,image,job_id from application_registry_requests where client_id=$1 and request_id=$2', [client.id, requestId])).rows[0]
          if (!record) throw new RegistryError('task_not_found', 404)
          const image = repositoryOf(record.image)
          if (!client.server_ids.includes(record.server_identity) || !inScope(`${image.registry}/${image.repository}`, client.repositories)) throw new RegistryError('deployment_scope_denied', 403)
          const task = await manager.jobs.configurationTask(record.job_id)
          if (!task) throw new RegistryError('task_not_found', 404)
          if (task.state === 'succeeded') {
            const current = await manager.credentials.read()
            const receipt = (task.result as { receipt?: { revision: number; configRevision: string } } | null)?.receipt
            const binding = (await manager.bindings()).find(value => value.server_identity === record.server_identity)
            if (!receipt || !current.configured || current.revision !== receipt.revision || !binding?.active || binding.type_key !== '@smp/console-application-server/application-server' || String(binding.current_config_revision) !== receipt.configRevision) {
              send(response, 200, { ...task, state: 'failed', result: { error: 'credential_receipt_stale' } }); return
            }
          }
          send(response, 200, task); return
        }
        throw new RegistryError('method_not_allowed', 405)
      }
      if (await context.consoleSession.read(request.headers.cookie ?? '') === undefined) throw new RegistryError('auth_required', 401)
      if (request.method !== 'GET') origin(request)
      if (path === '/targets' && request.method === 'GET') { send(response, 200, { targets: (await db.query('select id,name,host from servers where type_key=$1 order by name', ['@smp/console-application-server/application-server'])).rows }); return }
      if (path === '/bindings' && request.method === 'GET') { send(response, 200, { bindings: await manager.statusBindings() }); return }
      if (path.startsWith('/bindings/') && request.method === 'POST') {
        const value = await body(request)
        if (typeof value.active !== 'boolean') throw new RegistryError('invalid_request', 400)
        await manager.setActive(path.slice('/bindings/'.length), value.active)
        await manager.reconcile(); send(response, 200, { ok: true }); return
      }
      if (path === '/clients' && request.method === 'GET') { send(response, 200, { clients: (await db.query('select id,name,server_ids,repositories,created_at from application_registry_clients order by created_at desc')).rows }); return }
      if (path === '/clients' && request.method === 'POST') {
        const value = await body(request)
        if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || !Array.isArray(value.serverIds) || !value.serverIds.length || value.serverIds.length > 100 || !value.serverIds.every(uuid)) throw new RegistryError('invalid_client', 400)
        const repositories = scopes(value.repositories)
        const credential = await manager.credentials.read()
        if (!credential.configured || repositories.some(scope => !scope.startsWith(credential.registry + '/') || !inScope(scope.slice(credential.registry.length + 1).replace(/\/\*$/, '/__scope__'), credential.repositories) && !credential.repositories.includes(scope.slice(credential.registry.length + 1)))) throw new RegistryError('image_scope_denied', 403)
        const servers = (await db.query<{ id: string }>('select id from servers where id=any($1::uuid[]) and type_key=$2', [value.serverIds, '@smp/console-application-server/application-server'])).rows
        if (new Set(value.serverIds).size !== servers.length) throw new RegistryError('application_server_required')
        const token = 'ces_' + randomBytes(32).toString('base64url')
        const id = randomUUID()
        await db.query('insert into application_registry_clients(id,name,token_hash,server_ids,repositories) values($1,$2,$3,$4,$5)', [id, value.name.trim(), tokenHash(token), JSON.stringify(value.serverIds), JSON.stringify(repositories)])
        send(response, 201, { id, token }); return
      }
      if (path.startsWith('/clients/') && request.method === 'DELETE' && uuid(path.slice('/clients/'.length))) {
        await db.query('delete from application_registry_clients where id=$1', [path.slice('/clients/'.length)]); send(response, 200, { ok: true }); return
      }
      throw new RegistryError('not_found', 404)
    } catch (cause) {
      send(response, cause instanceof RegistryError ? cause.status : 500, { error: cause instanceof RegistryError ? cause.code : 'registry_operation_failed' })
    }
  }
}
