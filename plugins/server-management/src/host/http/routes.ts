import { downloadRoute } from '../admin/http.ts'
import { AdminError } from '../admin/model.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ServerError } from '../../shared/errors.ts'
import { errorPayload } from '../../shared/i18n.ts'
import { type Deps } from '../dependencies.ts'
import { HttpError } from '../errors.ts'
import { routeAudits } from './audits.ts'
import { routeHarnessSettings } from './harness-settings.ts'
import { routeComponents, routeTypes } from './catalog.ts'
import { routeChanges } from './changes.ts'
import { routeGroups } from './groups.ts'
import { routeJobs } from './jobs.ts'
import { routeKeys } from './keys.ts'
import { cookieHeader, sendJson } from './reply.ts'
import { routeServers } from './servers.ts'

export interface HttpHost {
  consoleSession: { read(cookieHeader: string): Promise<unknown> }
  logger: { error(error: unknown): void }
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}
export function* registerRoutes(host: HttpHost, deps: Deps): Generator<() => void> {
  yield host.webServer.register({
    kind: 'prefix',
    path: '/console-api/server-admin-downloads',
    handler: (request, response) =>
      guard(host, request, response, () =>
        deps.adminRun
          ? deps.adminRun((signal) =>
              downloadRoute(
                deps,
                request,
                response,
                suffix(request, '/console-api/server-admin-downloads').slice(1),
                signal,
              ),
            )
          : downloadRoute(
              deps,
              request,
              response,
              suffix(request, '/console-api/server-admin-downloads').slice(1),
            ),
      ),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/servers',
    handler: (request, response) =>
      guard(host, request, response, () => routeServers(deps, request, response, '')),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/servers/test-connection',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeServers(deps, request, response, '/test-connection'),
      ),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/servers/identify-system',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeServers(deps, request, response, '/identify-system'),
      ),
  })
  yield host.webServer.register({
    kind: 'prefix',
    path: '/console-api/servers',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeServers(deps, request, response, suffix(request, '/console-api/servers')),
      ),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/server-groups',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeGroups(deps.db, request, response, '', deps.definitions),
      ),
  })
  yield host.webServer.register({
    kind: 'prefix',
    path: '/console-api/server-groups',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeGroups(
          deps.db,
          request,
          response,
          suffix(request, '/console-api/server-groups'),
          deps.definitions,
        ),
      ),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/ssh-keys',
    handler: (request, response) =>
      guard(host, request, response, () => routeKeys(deps, request, response, '')),
  })
  yield host.webServer.register({
    kind: 'prefix',
    path: '/console-api/ssh-keys',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeKeys(deps, request, response, suffix(request, '/console-api/ssh-keys')),
      ),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/server-types',
    handler: (request, response) =>
      guard(host, request, response, () => routeTypes(deps.definitions, request, response)),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/components',
    handler: (request, response) =>
      guard(host, request, response, async () => {
        routeComponents(deps.catalog, request, response)
      }),
  })
  yield host.webServer.register({
    kind: 'prefix',
    path: '/console-api/server-jobs',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeJobs(deps.db, request, response, suffix(request, '/console-api/server-jobs')),
      ),
  })
  yield host.webServer.register({
    kind: 'exact',
    path: '/console-api/server-management-settings',
    handler: (request, response) =>
      guard(host, request, response, () => routeHarnessSettings(deps, request, response)),
  })
  yield host.webServer.register({
    kind: 'prefix',
    path: '/console-api/server-audits',
    handler: (request, response) =>
      guard(host, request, response, () => routeAudits(deps, request, response)),
  })
  yield host.webServer.register({
    kind: 'prefix',
    path: '/console-api/server-changes',
    handler: (request, response) =>
      guard(host, request, response, () =>
        routeChanges(deps, request, response, suffix(request, '/console-api/server-changes')),
      ),
  })
}
async function guard(
  ctx: HttpHost,
  request: IncomingMessage,
  response: ServerResponse,
  run: () => Promise<void>,
): Promise<void> {
  if ((await ctx.consoleSession.read(cookieHeader(request))) === undefined) {
    sendJson(response, 401, errorPayload(new ServerError('unauthorized')))
    return
  }
  try {
    await run()
  } catch (cause) {
    if (cause instanceof AdminError) {
      sendJson(response, 422, { code: cause.code })
      return
    }
    if (cause instanceof HttpError) {
      sendJson(response, cause.status, errorPayload(cause))
      return
    }
    if (cause instanceof ServerError) {
      sendJson(response, 422, errorPayload(cause))
      return
    }
    if (cause instanceof SyntaxError) {
      sendJson(response, 400, errorPayload(new ServerError('invalid_request')))
      return
    }
    ctx.logger.error(cause)
    if (!response.headersSent)
      sendJson(response, 500, errorPayload(new ServerError('request_failed')))
  }
}

function suffix(request: IncomingMessage, prefix: string): string {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  return path.startsWith(prefix) ? path.slice(prefix.length) : ''
}
