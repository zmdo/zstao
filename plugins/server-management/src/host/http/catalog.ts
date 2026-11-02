import type { IncomingMessage, ServerResponse } from 'node:http'
import { componentView, type Component } from '../definitions/catalog.ts'
import { DefinitionRegistry } from '../definitions/registry.ts'
import { HttpError } from '../errors.ts'
import { UUID } from '../input.ts'
import { sendJson } from './reply.ts'

export async function routeTypes(
  definitions: DefinitionRegistry,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed')
  const id = new URL(request.url ?? '/', 'http://localhost').searchParams.get('group_id')
  if (id && !UUID.test(id)) throw new HttpError(404, 'group_not_found')
  sendJson(response, 200, await definitions.options(id || null))
}

export function routeComponents(
  catalog: readonly Component[],
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed')
  sendJson(response, 200, componentView(catalog))
}
