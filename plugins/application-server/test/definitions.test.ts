import assert from 'node:assert/strict'
import test from 'node:test'
import { applicationServerDefinitions, applicationServerType } from '../src/index.ts'

test('application server type requires Docker and is public', () => {
  assert.equal(applicationServerDefinitions.owner, '@smp/console-application-server')
  const type = applicationServerDefinitions.types?.find(item => `${applicationServerDefinitions.owner}/${item.key}` === applicationServerType)
  assert.ok(type)
  assert.deepEqual(type.requirements.map(item => item.software), [
    '@smp/console-container-runtime/docker-engine',
    '@smp/console-container-runtime/docker-compose',
  ])
  assert.equal(applicationServerDefinitions.publicTypes?.[0]?.type, applicationServerType)
})

test('application definitions wait for the declared container runtime dependency', async () => {
  const { apply, inject } = await import('../src/index.ts')
  assert.ok(inject.includes('containerRuntime'))
  let ready!: () => void
  let registered = false
  const promise = apply({
    containerRuntime: { ready: new Promise<void>(resolve => { ready = resolve }) },
    serverManagement: { registerDefinitions() { registered = true; throw new Error('registration reached') } },
  } as never)
  await Promise.resolve()
  assert.equal(registered, false)
  ready()
  await assert.rejects(promise, /registration reached/)
  assert.equal(registered, true)
})
