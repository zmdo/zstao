import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Db } from '../database/connection.ts'
import { HttpError } from '../errors.ts'
import { UUID } from '../input.ts'
import { readJob, taskHistory } from '../tasks/queries.ts'
import { cancelJob } from '../tasks/cancel.ts'
import { sendJson } from './reply.ts'
import { parseTaskQuery } from './task-query.ts'

export async function routeJobs(
  db: Db,
  request: IncomingMessage,
  response: ServerResponse,
  rest: string,
): Promise<void> {
  if (rest === '' && request.method === 'GET') {
    const query = parseTaskQuery(new URL(request.url ?? '/', 'http://localhost').searchParams)
    return sendJson(response, 200, await taskHistory(db, query))
  }
  const parts = rest.split('/').filter(Boolean)
  const id = parts[0] ?? ''
  if (request.method === 'POST' && parts.length === 2 && parts[1] === 'cancel' && UUID.test(id)) {
    await cancelJob(db, id)
    const result = await readJob(db, id)
    if (result !== undefined) return sendJson(response, 200, result)
  }
  if (request.method === 'GET' && parts.length === 1 && UUID.test(id)) {
    const result = await readJob(db, id)
    if (result !== undefined) return sendJson(response, 200, result)
  }
  throw new HttpError(404, 'job_not_found')
}
