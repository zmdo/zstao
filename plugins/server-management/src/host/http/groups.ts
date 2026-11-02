import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Db } from '../database/connection.ts'
import { DefinitionRegistry } from '../definitions/registry.ts'
import { HttpError } from '../errors.ts'
import { createGroup, deleteGroup, listGroups, renameGroup } from '../groups/service.ts'
import { UUID } from '../input.ts'
import { readJson, sendJson } from './reply.ts'

export async function routeGroups(
  db: Db,
  request: IncomingMessage,
  response: ServerResponse,
  rest: string,
  definitions: DefinitionRegistry,
): Promise<void> {
  if (rest === '' && request.method === 'GET')
    return sendJson(response, 200, await listGroups(db, definitions))
  if (rest === '' && request.method === 'POST')
    return sendJson(response, 201, await createGroup(db, definitions, await readJson(request)))
  const id = rest.slice(1)
  if (request.method === 'PATCH' && UUID.test(id))
    return sendJson(response, 200, await renameGroup(db, definitions, id, await readJson(request)))
  if (request.method === 'DELETE' && UUID.test(id)) {
    await deleteGroup(db, id)
    response.writeHead(204)
    response.end()
    return
  }
  throw new HttpError(404, 'group_not_found')
}
