import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config } from '../src/index.ts'
import { normalizeDatabaseUrl } from '../src/url.ts'

const KEY = 'DJgTLH4djm-MziO9AWRlGWIuSCWSvj4Vdp8C1PDhZuw='

test('databaseUrl and encryptionKey are required', () => {
  assert.throws(() => Config({}))
  assert.throws(() => Config({ databaseUrl: 'postgresql://localhost/smp' }))
})

test('a psycopg URL is accepted as a PostgreSQL URL', () => {
  assert.equal(
    normalizeDatabaseUrl('postgresql+psycopg://smp:smp_dev@postgres:5432/smp'),
    'postgresql://smp:smp_dev@postgres:5432/smp',
  )
})

test('a non-PostgreSQL URL is rejected', () => {
  assert.throws(() => normalizeDatabaseUrl('mysql://localhost/smp'), /PostgreSQL/)
})

test('an invalid encryption key fails the plugin', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin({ apply, Config, inject: [] }, {
    databaseUrl: 'postgresql://localhost/smp',
    encryptionKey: 'not-a-key',
  })
  await assert.rejects(() => Promise.resolve(fiber))
})

test('an unreachable database fails the plugin', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin({ apply, Config, inject: [] }, {
    databaseUrl: 'postgresql://127.0.0.1:1/smp',
    encryptionKey: KEY,
  })
  await assert.rejects(() => Promise.resolve(fiber))
})
