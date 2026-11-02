import assert from 'node:assert/strict'
import test from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, inject } from '../src/index.ts'
import type { AccountRow } from '../src/account.ts'
import { hashPassword } from '../src/password.ts'
import { sealSession } from '../src/session.ts'

const SECRET = 'session-secret'

interface Reply {
  status: number
  headers: Record<string, string | readonly string[]>
  body: string
  setHeader(name: string, value: string | readonly string[]): void
  writeHead(status: number, headers?: Record<string, string | readonly string[]>): void
  end(body?: string): void
}

function reply(): Reply {
  return {
    status: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    writeHead(status, headers) {
      this.status = status
      if (headers === undefined) return
      for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value
    },
    end(body) { this.body = body ?? '' },
  }
}

function request(method: string, cookie = '', json?: string): IncomingMessage {
  const chunks = json === undefined ? [] : [Buffer.from(json)]
  return {
    method,
    url: '/',
    headers: { cookie },
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
  } as IncomingMessage
}

function poolFor(account: AccountRow | undefined, count = 1) {
  return {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('count(*)')) return { rows: [{ count }] }
      if (sql.includes('where username')) {
        if (account !== undefined && params?.[0] === account.username) return { rows: [account] }
        return { rows: [] }
      }
      throw new Error(sql)
    },
  }
}

async function start(account: AccountRow | undefined) {
  const root = new Context()
  const routes = new Map<string, (request: IncomingMessage, response: ServerResponse) => void | Promise<void>>()
  const forwarded: { method?: string; url?: string }[] = []
  let admitted = false
  const connection = {
    authorizeIndex(next: { method?: string; url?: string }) {
      forwarded.push(next)
      return true
    },
    authenticatedUrl() { return 'http://127.0.0.1/?token=launch-token' },
    admit() { return admitted ? {} : { rejection: 1 } },
  }
  root.provide('database', { pool: poolFor(account) })
  root.provide('webServer', {
    register(route: { path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }) {
      routes.set(route.path, route.handler)
      return () => { routes.delete(route.path) }
    },
  })
  root.provide('connection', connection)
  const fiber = root.plugin({ apply, Config, inject }, {
    sessionSecret: SECRET,
    initialUsername: 'admin',
  })
  await fiber
  return {
    routes,
    forwarded,
    connection,
    fiber,
    admit(next: boolean) { admitted = next },
  }
}

test('sessionSecret is required and the first username defaults to admin', () => {
  assert.throws(() => Config({}))
  const config = Config({ sessionSecret: SECRET })
  assert.equal(config.initialUsername, 'admin')
  assert.equal(config.initialPassword, undefined)
})

test('an empty account table without a password fails the plugin', async () => {
  const root = new Context()
  root.provide('database', { pool: poolFor(undefined, 0) })
  root.provide('webServer', { register() { return () => {} } })
  root.provide('connection', {
    authorizeIndex() { return true },
    authenticatedUrl() { return 'http://127.0.0.1/' },
    admit() { return {} },
  })
  const fiber = root.plugin({ apply, Config, inject }, { sessionSecret: SECRET })
  await assert.rejects(() => Promise.resolve(fiber), /初始密码没有配置/)
})

test('a missing session is sent to the login page and a signed session mints the page connection', async () => {
  const account: AccountRow = {
    username: 'admin',
    password_hash: hashPassword('secret'),
    totp_enabled: false,
    totp_secret: null,
  }
  const host = await start(account)
  const login = reply()
  host.connection.authorizeIndex({ method: 'GET', url: '/', headers: { cookie: '' } }, login)
  assert.equal(login.status, 303)
  assert.equal(login.headers.location, '/login')
  assert.equal(host.forwarded.length, 0)

  const minted = reply()
  const cookie = `smp_session=${sealSession('admin', SECRET)}`
  host.connection.authorizeIndex({ method: 'GET', url: '/?x=1', headers: { cookie } }, minted)
  assert.equal(host.forwarded[0]?.url, '/?x=1&token=launch-token')

  host.admit(true)
  host.connection.authorizeIndex({ method: 'GET', url: '/kept', headers: { cookie } }, reply())
  assert.equal(host.forwarded[1]?.url, '/kept')

  const page = reply()
  await host.routes.get('/login')!(request('GET', cookie), page as unknown as ServerResponse)
  assert.equal(page.status, 303)

  const me = reply()
  await host.routes.get('/console-api/auth/me')!(request('GET', cookie), me as unknown as ServerResponse)
  assert.equal(JSON.parse(me.body).username, 'admin')

  const posted = reply()
  await host.routes.get('/console-api/auth/login')!(
    request('POST', '', JSON.stringify({ username: 'admin', password: 'secret' })),
    posted as unknown as ServerResponse,
  )
  assert.equal(posted.status, 200)
  assert.match(String(posted.headers['set-cookie']), /^smp_session=/)

  await host.fiber.dispose()
  const after = reply()
  host.connection.authorizeIndex({ method: 'GET', url: '/', headers: { cookie: '' } }, after)
  assert.equal(after.status, 0)
  assert.equal(host.forwarded.at(-1)?.url, '/')
})
