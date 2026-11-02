import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import {builtinCatalog} from '../src/host/definitions/catalog.ts'
import type { Db } from '../src/host/database/connection.ts'
import { registerRoutes, type HttpHost } from '../src/host/http/routes.ts'
import { Enrollment } from '../src/host/servers/enrollment.ts'
import {DefinitionRegistry} from '../src/host/definitions/registry.ts'

test('registered HTTP adapters retain authentication, error responses and route cleanup', async (t) => {
  let queries = 0
  const databaseFailure = new Error('Database fixture unavailable')
  const db: Db = {
    async query() {
      queries++
      throw databaseFailure
    },
    async connect() {
      throw databaseFailure
    },
  }
  const catalog = builtinCatalog(),
    definitions = new DefinitionRegistry(db, catalog)
  const secrets = { encrypt: (value: string) => value, decrypt: (value: string) => value }
  const enrollment = new Enrollment({ db, definitions, secrets })
  t.after(async () => {
    await enrollment.close()
    await definitions.close()
  })
  type Route = Parameters<HttpHost['webServer']['register']>[0]
  const routes: Route[] = [],
    errors: unknown[] = []
  const host: HttpHost = {
    consoleSession: {
      async read(cookie) {
        return cookie === 'session=test' ? {} : undefined
      },
    },
    logger: {
      error(cause) {
        errors.push(cause)
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          routes.splice(routes.indexOf(route), 1)
        }
      },
    },
  }
  const disposers = [...registerRoutes(host, { db, catalog, definitions, secrets, enrollment })]
  t.after(() => {
    for (const dispose of [...disposers].reverse()) dispose()
  })
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const route =
      routes.find((r) => r.kind === 'exact' && r.path === path) ??
      routes.find((r) => r.kind === 'prefix' && path.startsWith(r.path))
    if (route) await route.handler(request, response)
    else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  async function api(path: string, method = 'GET', body?: string, authenticated = true) {
    const response = await fetch(`http://127.0.0.1:${port}/console-api/${path}`, {
      method,
      headers: authenticated ? { cookie: 'session=test' } : {},
      body,
      signal: AbortSignal.timeout(5000),
    })
    return { status: response.status, payload: (await response.json()) as { code: string; detail: string } }
  }
  const unauthorized = await api('servers', 'POST', '{', false)
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.payload.code, 'unauthorized')
  assert.equal(queries, 0)
  const invalid = await api('servers?page=bad')
  assert.equal(invalid.status, 422)
  assert.equal(invalid.payload.code, 'server_query_invalid')
  const malformed = await api('servers', 'POST', '{')
  assert.equal(malformed.status, 400)
  assert.equal(malformed.payload.code, 'invalid_request')
  const method = await api('server-types', 'POST', '{}')
  assert.equal(method.status, 405)
  assert.equal(method.payload.code, 'method_not_allowed')
  const missing = await api('server-changes/plans/not-a-uuid')
  assert.equal(missing.status, 404)
  assert.equal(missing.payload.code, 'plan_not_ready')
  const failed = await api('server-groups')
  assert.equal(failed.status, 500)
  assert.equal(failed.payload.code, 'request_failed')
  assert.equal(failed.payload.detail.includes(databaseFailure.message), false)
  assert.deepEqual(errors, [databaseFailure])
  for (const dispose of disposers.splice(0).reverse()) dispose()
  assert.equal(routes.length, 0)
  assert.equal((await fetch(`http://127.0.0.1:${port}/console-api/servers`)).status, 404)
})
