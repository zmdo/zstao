import assert from 'node:assert/strict'
import test from 'node:test'
import { ConfigurationRegistry } from '../src/host/configurations/registry.ts'
import type { Db } from '../src/host/database/connection.ts'
import type { ConfigurationContext } from '../src/host/configurations/contracts.ts'

test('configuration provider withdrawal rejects new work and drains admitted execution', async () => {
  const registry = new ConfigurationRegistry({} as Db)
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocking = new Promise<void>(resolve => { release = resolve })
  const registration = registry.register({ owner: '@test/config', key: 'action', validate: input => input as never,
    execute: async () => { entered(); await blocking; return { ok: true } } })
  const task = registry.execute('@test/config/action', {} as ConfigurationContext)
  await started
  let disposed = false
  const dispose = registration.dispose().then(() => { disposed = true })
  assert.deepEqual(registry.keys(), [])
  await assert.rejects(registry.execute('@test/config/action', {} as ConfigurationContext), /configuration_provider_unavailable/)
  assert.equal(disposed, false)
  release(); assert.deepEqual(await task, { ok: true }); await dispose
  assert.equal(disposed, true)
  await registry.close()
  assert.throws(() => registry.register({ owner: '@test/config', key: 'action', validate: () => null, execute: async () => null }), /configuration_registration_invalid/)
})
