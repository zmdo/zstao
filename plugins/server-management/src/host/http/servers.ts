import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Deps } from '../dependencies.ts'
import { HttpError } from '../errors.ts'
import { UUID } from '../input.ts'
import { serverList, serverRead } from '../servers/list.ts'
import {
  createServer,
  deleteServer,
  enqueueExisting,
  serverDetail,
  updateServer,
} from '../servers/service.ts'
import { jobView } from '../tasks/queries.ts'
import { readJson, sendJson } from './reply.ts'
import { extensionSettings, saveExtensionSettings } from '../extensions/settings.ts'
import { readExtensionObservations } from '../extensions/observations.ts'
import { applyExtensionSettingsPlan, planExtensionSettings } from '../extensions/settings-plan.ts'
import { parseServerListQuery } from './server-query.ts'
import { metricHistory, metricHistoryCustom, metricRange } from '../servers/metric-history.ts'

export async function routeServers(
  deps: Deps,
  request: IncomingMessage,
  response: ServerResponse,
  rest: string,
): Promise<void> {
  if (rest === '' && request.method === 'GET')
    return sendJson(
      response,
      200,
      await serverList(
        deps,
        parseServerListQuery(new URL(request.url ?? '/', 'http://localhost').searchParams),
      ),
    )
  if (rest === '' && request.method === 'POST')
    return sendJson(response, 201, await createServer(deps, await readJson(request)))
  if (rest === '/test-connection' && request.method === 'POST')
    return sendJson(response, 200, await deps.enrollment.test(await readJson(request)))
  if (rest === '/identify-system' && request.method === 'POST')
    return sendJson(response, 200, await deps.enrollment.identify(await readJson(request)))
  const parts = rest.split('/').filter(Boolean)
  const id = parts[0] ?? ''
  if (!UUID.test(id)) throw new HttpError(404, 'server_not_found')
  if (parts.length === 1 && request.method === 'GET')
    return sendJson(response, 200, await serverDetail(deps, id))
  if (parts.length === 1 && request.method === 'PATCH')
    return sendJson(response, 200, await updateServer(deps, id, await readJson(request)))
  if (parts.length === 1 && request.method === 'DELETE') {
    await deleteServer(deps.db, id)
    response.writeHead(204)
    response.end()
    return
  }
  if (parts.length === 2 && parts[1] === 'metrics' && request.method === 'GET') {
    const server = await serverRead(deps, id)
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams
    const fromText = params.get('from')
    const toText = params.get('to')
    if (fromText !== null || toText !== null) {
      const from = fromText === null ? new Date(Number.NaN) : new Date(fromText)
      const to = toText === null ? new Date(Number.NaN) : new Date(toText)
      const earliest = new Date((server as { created_at?: string | Date }).created_at ?? 0).getTime()
      if (
        Number.isNaN(from.getTime()) ||
        Number.isNaN(to.getTime()) ||
        to <= from ||
        from.getTime() < earliest ||
        to.getTime() - from.getTime() > 366 * 24 * 3600 * 1000
      )
        throw new HttpError(422, 'metric_range_invalid')
      return sendJson(response, 200, await metricHistoryCustom(deps.db, id, from, to))
    }
    const range = metricRange(params.get('range'))
    if (range === null) throw new HttpError(422, 'metric_range_invalid')
    return sendJson(response, 200, await metricHistory(deps.db, id, range))
  }
  if (parts.length === 2 && parts[1] === 'extensions' && request.method === 'GET') {
    const server = await serverRead(deps, id)
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    return sendJson(response, 200, { items: deps.extensions.catalogFor(server) })
  }
  if (parts.length === 2 && parts[1] === 'extension-observations' && request.method === 'GET') {
    const server = await serverRead(deps, id)
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    return sendJson(response, 200, { items: (await readExtensionObservations(deps.db, id)).rows })
  }
  if (parts.length === 2 && parts[1] === 'extension-inspections' && request.method === 'GET') {
    const server = await serverRead(deps, id)
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    return sendJson(response, 200, {
      items: deps.extensions.catalogFor(server).filter((entry) => entry.kind === 'inspection'),
    })
  }
  if (parts.length === 2 && parts[1] === 'extension-data' && request.method === 'GET') {
    const server = await serverRead(deps, id)
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    const key = new URL(request.url ?? '/', 'http://localhost').searchParams.get('key') ?? ''
    return sendJson(response, 200, {
      value: await deps.extensions.runQuery(server, key, new URL(request.url ?? '/', 'http://localhost').searchParams),
    })
  }
  if (parts.length === 3 && parts[1] === 'extension-settings' && (parts[2] === 'plan' || parts[2] === 'apply') && request.method === 'POST') {
    const server = await serverRead(deps, id)
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    const key = new URL(request.url ?? '/', 'http://localhost').searchParams.get('key') ?? ''
    const found = deps.extensions.settings(server, key)
    if (found.entry.affectsExecution !== true) throw new HttpError(422, 'extension_settings_requires_plan')
    const body = await readJson(request)
    const value = body !== null && typeof body === 'object' ? (body as { value?: unknown }).value : undefined
    const owner = found.entry.owner
    const section = key.slice(owner.length + 1)
    if (parts[2] === 'plan') {
      const revision =
        body !== null && typeof body === 'object' && typeof (body as { revision?: unknown }).revision === 'string'
          ? (body as { revision: string }).revision
          : undefined
      if (revision === undefined || !/^\d+$/.test(revision))
        throw new HttpError(422, 'extension_settings_invalid')
      const validated = found.runtime.validate(value)
      return sendJson(response, 200, await planExtensionSettings(deps.db, { serverId: id, owner, section, value: validated, expectedRevision: revision }, deps.extensions))
    }
    const planId = body !== null && typeof body === 'object' ? (body as { plan_id?: unknown }).plan_id : undefined
    const planDigest = body !== null && typeof body === 'object' ? (body as { digest?: unknown }).digest : undefined
    if (typeof planId !== 'string' || !UUID.test(planId) || typeof planDigest !== 'string' || !/^[0-9a-f]{64}$/.test(planDigest))
      throw new HttpError(422, 'extension_plan_invalid')
    return sendJson(response, 200, await applyExtensionSettingsPlan(deps.db, { serverId: id, owner, section, planId, digest: planDigest }, deps.extensions))
  }
  if (parts.length === 2 && parts[1] === 'extension-settings') {
    const server = await serverRead(deps, id)
    if (server === undefined) throw new HttpError(404, 'server_not_found')
    const key = new URL(request.url ?? '/', 'http://localhost').searchParams.get('key') ?? ''
    const found = deps.extensions.settings(server, key)
    if (request.method === 'GET') {
      const stored = await extensionSettings(deps.db, id, found.entry.owner, key.slice(found.entry.owner.length + 1))
      return sendJson(response, 200, {
        value: stored?.value ?? found.runtime.defaults,
        revision: stored?.revision ?? '0',
      })
    }
    if (request.method === 'PUT') {
      if (found.entry.affectsExecution === true) throw new HttpError(422, 'extension_settings_requires_plan')
      const body = await readJson(request)
      const value = body !== null && typeof body === 'object' ? (body as { value?: unknown }).value : undefined
      const revision =
        body !== null && typeof body === 'object' && typeof (body as { revision?: unknown }).revision === 'string'
          ? (body as { revision: string }).revision
          : undefined
      if (revision === undefined || !/^\d+$/.test(revision))
        throw new HttpError(422, 'extension_settings_invalid')
      const validated = found.runtime.validate(value)
      const saved = await saveExtensionSettings(deps.db, {
        serverId: id,
        owner: found.entry.owner,
        section: key.slice(found.entry.owner.length + 1),
        value: validated,
        expectedRevision: revision,
      }, deps.extensions)
      if (saved === undefined) throw new HttpError(409, 'extension_settings_conflict')
      return sendJson(response, 200, saved)
    }
  }
  const action =
    parts.length === 2
      ? (
          {
            test: 'test_connection',
            inspect: 'inspect',
            'install-components': 'install_components',
          } as Record<string, string>
        )[parts[1]!]
      : undefined
  if (action !== undefined && request.method === 'POST')
    return sendJson(response, 202, jobView(await enqueueExisting(deps, id, action)))
  throw new HttpError(404, 'server_not_found')
}
