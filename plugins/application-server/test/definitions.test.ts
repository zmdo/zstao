import assert from 'node:assert/strict'
import test from 'node:test'
import { applicationServerDefinitions, applicationServerType } from '../src/index.ts'

test('application server requires Docker, Compose and the Docker-dependent gateway', () => {
  assert.equal(applicationServerDefinitions.owner, '@smp/console-application-server')
  const type = applicationServerDefinitions.types?.find(item => `${applicationServerDefinitions.owner}/${item.key}` === applicationServerType)
  assert.ok(type)
  assert.deepEqual(type.requirements.map(item => item.software), [
    '@smp/console-container-runtime/docker-engine',
    '@smp/console-container-runtime/docker-compose',
    '@smp/console-application-server/openresty',
  ])
  assert.equal(applicationServerDefinitions.publicTypes?.[0]?.type, applicationServerType)
  const recipe = applicationServerDefinitions.recipes?.find(item => item.key === 'openresty-docker')
  assert.equal(recipe?.requires?.[0]?.software, '@smp/console-container-runtime/docker-engine')
})
