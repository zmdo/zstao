import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Deps } from '../dependencies.ts'
import { HttpError } from '../errors.ts'
import { UUID } from '../input.ts'
import { createKey, deleteKey, listKeys } from '../keys/service.ts'
import { readJson, sendJson } from './reply.ts'

export async function routeKeys(
  deps: Deps,
  request: IncomingMessage,
  response: ServerResponse,
  rest: string,
): Promise<void> {
  if (rest === '' && request.method === 'GET') return sendJson(response, 200, await listKeys(deps.db))
  if (rest === '' && request.method === 'POST')
    return sendJson(response, 201, await createKey(deps, await readJson(request)))
  const id = rest.slice(1)
  if (request.method === 'DELETE' && UUID.test(id)) {
    await deleteKey(deps.db, id)
    response.writeHead(204)
    response.end()
    return
  }
  throw new HttpError(404, 'key_not_found')
}
