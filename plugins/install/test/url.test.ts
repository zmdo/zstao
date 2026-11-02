import assert from 'node:assert/strict'
import test from 'node:test'
import { composeDatabaseUrl } from '../src/url.ts'

test('database fields become one PostgreSQL URL', () => {
  const composed = composeDatabaseUrl({
    host: '127.0.0.1',
    port: '54329',
    database: 'smp',
    username: 'smp',
    password: 'p@ss/word',
  })
  assert.equal(composed.ok, true)
  if (!composed.ok) return
  assert.equal(composed.url, 'postgresql://smp:p%40ss%2Fword@127.0.0.1:54329/smp')
})

test('a bad port is rejected before a connection is attempted', () => {
  const composed = composeDatabaseUrl({
    host: '127.0.0.1',
    port: '0',
    database: 'smp',
    username: 'smp',
    password: 'secret',
  })
  assert.deepEqual(composed, { ok: false, detail: '端口必须是 1 到 65535' })
})
