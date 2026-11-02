import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Deps } from '../dependencies.ts'
import { loadExecLimits, saveExecLimits } from '../harness/settings-service.ts'
import { HttpError } from '../errors.ts'
import { readJson, sendJson } from './reply.ts'

export async function routeHarnessSettings(
  deps: Deps,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET') {
    const fallback = deps.execLimits
    if (fallback === undefined) throw new HttpError(500, 'request_failed')
    return sendJson(response, 200, await loadExecLimits(deps.db, fallback))
  }
  if (request.method === 'PUT') {
    if (deps.execLimits === undefined) throw new HttpError(500, 'request_failed')
    const saved = await saveExecLimits(deps.db, await readJson(request), 'console')
    Object.assign(deps.execLimits, saved)
    return sendJson(response, 200, saved)
  }
  throw new HttpError(404, 'server_not_found')
}
