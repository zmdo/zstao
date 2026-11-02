import assert from 'node:assert/strict'
import test from 'node:test'
import type { Db } from '../src/host/database/connection.ts'
import { builtinCatalog } from '../src/host/definitions/catalog.ts'
import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import { ServerExtensionRegistry } from '../src/host/extensions/registry.ts'
import { containerDefinitions, containerExtensions } from '../../server-containers/src/index.ts'
import { containerRuntimeDefinitions } from '../../container-runtime/src/index.ts'

function fakeDb(): Db {
  const client = { async query() { return { rows: [] } }, release() {} }
  return { connect: async () => client } as unknown as Db
}

test('the container plugin registers its public type, software and extension metadata', async () => {
  const definitions = new DefinitionRegistry(fakeDb(), builtinCatalog())
  const runtimeRegistration = definitions.registerDefinitions(containerRuntimeDefinitions)
  await runtimeRegistration.ready
  const definitionsRegistration = definitions.registerDefinitions(containerDefinitions)
  await definitionsRegistration.ready
  const type = definitions.defaultOptions().types.find((item) => item.key === '@smp/console-server-containers/container')
  assert.ok(type)
  assert.deepEqual(type.software.map((item) => item.software_key).sort(), [
    '@smp/console-container-runtime/docker-compose',
    '@smp/console-container-runtime/docker-engine',
  ])
  const extensions = new ServerExtensionRegistry(definitions)
  const registration = extensions.registerExtensions(containerExtensions)
  await registration.ready
  assert.deepEqual(
    extensions.list('@smp/console-server-containers/container').map((item) => `${item.kind}:${item.key}`),
    [
      'inspection:@smp/console-server-containers/container-check',
      'query:@smp/console-server-containers/container-list',
      'settings:@smp/console-server-containers/container-settings',
      'panel:@smp/console-server-containers/containers',
    ],
  )
  await registration.dispose()
  await definitionsRegistration.dispose()
  await runtimeRegistration.dispose()
  extensions.close()
  await definitions.close()
})
