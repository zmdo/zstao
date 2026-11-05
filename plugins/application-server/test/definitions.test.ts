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
