import assert from 'node:assert/strict'
import test from 'node:test'
import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import type { TypeSetupContext } from '../src/host/definitions/runtime.ts'
import type { Db } from '../src/host/database/connection.ts'
import type { DefinitionBundle } from '../src/shared/contracts/definitions.ts'
import { setupType } from '../src/host/execution/type-setup.ts'
import type { SshSession } from '../src/host/remote/ssh.ts'

const bundle: DefinitionBundle = {
  contractVersion: 2, owner: '@test/setup',
  types: [{ key: 'app', name: { zh: '应用', en: 'App' }, supportedOs: { kind: 'all' }, requirements: [], requiresSetup: true }],
  publicTypes: [{ type: '@test/setup/app' }],
}
const client = { async query() { return { rows: [] } }, release() {} }
const db = { connect: async () => client } as unknown as Db
const context: TypeSetupContext = { operation: 'prepare', serverId: 'server', sshUser: 'root', guard: async () => {}, exec: async () => ({ code: 0, stdout: '', stderr: '' }) }

test('setup metadata requires a callback; public leases pin their provider', async () => {
  const definitions = new DefinitionRegistry(db, [])
  await assert.rejects(definitions.registerDefinitions(bundle).ready, { code: 'type_setup_unavailable' })
  const registration = definitions.registerDefinitions(bundle, bundle, { types: { app: async () => {} } })
  await registration.ready
  const lease = await definitions.lease(null, '@test/setup/app')
  assert.ok(lease?.type.requiresSetup)
  let stopped = false
  const stopping = registration.dispose().then(() => { stopped = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, false)
  lease.release()
  await stopping
  await assert.rejects(definitions.setupType(lease.type, context), { code: 'type_setup_unavailable' })
  await definitions.close()
})

test('unload drains admitted setup and callback failures never expose credentials', async () => {
  const definitions = new DefinitionRegistry(db, [])
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  const registration = definitions.registerDefinitions(bundle, bundle, { types: { app: async () => { enter(); await blocked; throw new Error('password=never-log-this') } } })
  await registration.ready
  const type = definitions.defaultOptions().types.find(t => t.key === '@test/setup/app')!
  const pending = assert.rejects(definitions.setupType(type, context), error => {
    assert.equal((error as { code: string }).code, 'type_setup_failed')
    assert.equal(String(error).includes('never-log-this'), false)
    assert.equal((error as Error).cause, undefined)
    return true
  })
  await entered
  let disposed = false
  const stopping = registration.dispose().then(() => { disposed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposed, false)
  release()
  await pending
  await stopping
  await definitions.close()
})

test('type preparation happens on the target and switching away removes only the previous type config', async () => {
  const definitions = new DefinitionRegistry(db, [])
  const operations: string[] = []
  const registration = definitions.registerDefinitions(bundle, bundle, { types: { app: async c => { operations.push(c.operation) } } })
  await registration.ready
  const app = definitions.defaultOptions().types.find(t => t.key === '@test/setup/app')!
  const vacant = definitions.defaultOptions().types.find(t => t.key === 'builtin/vacant')!
  const session = { exec: context.exec } as SshSession
  await setupType(definitions, session, { id: 's', ssh_user: 'root', type_snapshot: vacant }, app, context.guard)
  // A snapshot saved by 911443e/08f3947 did not contain requiresSetup.
  const { requiresSetup: _oldCapability, ...oldSnapshot } = app
  await setupType(definitions, session, { id: 's', ssh_user: 'root', type_snapshot: oldSnapshot }, vacant, context.guard)
  assert.deepEqual(operations, ['prepare', 'remove'])
  await registration.dispose()
  await definitions.close()
})
