import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Deps } from '../dependencies.ts'
import { listAuditRecords } from '../audit/service.ts'
import { HttpError } from '../errors.ts'
import { parseAuditQuery } from './audit-query.ts'
import { sendJson } from './reply.ts'

export async function routeAudits(
  deps: Deps,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') throw new HttpError(404, 'audit_not_found')
  const params = new URL(request.url ?? '/', 'http://localhost').searchParams
  return sendJson(response, 200, await listAuditRecords(deps.db, parseAuditQuery(params)))
}
