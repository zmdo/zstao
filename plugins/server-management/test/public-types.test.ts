import assert from 'node:assert/strict'
import test from 'node:test'
import type { Db } from '../src/host/database/connection.ts'
import { builtinCatalog } from '../src/host/definitions/catalog.ts'
import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import type { DefinitionBundle } from '../src/shared/contracts/definitions.ts'
import type { GroupRow } from '../src/host/groups/persistence/rows.ts'

function fakeDb(): Db {
  let group = 0
  const client = {
    async query(sql: string) {
      if (sql.includes('insert into server_groups')) return { rows: [{ id: `group-${++group}` }] }
      return { rows: [] }
    },
    release() {},
  }
  return { connect: async () => client } as unknown as Db
}

const bundle: DefinitionBundle = {
  contractVersion: 2,
  owner: '@test/public',
  types: [
    {
      key: 'database',
      name: { zh: '数据库服务器', en: 'Database server' },
      supportedOs: { kind: 'all' },
      requirements: [],
    },
  ],
  publicTypes: [{ type: '@test/public/database', order: 20 }],
  groups: [
    { key: 'inherited', name: { zh: '继承目录', en: 'Inherited' } },
    {
      key: 'explicit',
      name: { zh: '显式空置', en: 'Explicit vacant' },
      types: ['builtin/vacant'],
    },
  ],
}

test('public types enter the user catalog and inherited system groups, but not explicit groups', async () => {
  const definitions = new DefinitionRegistry(fakeDb(), builtinCatalog())
  const registration = definitions.registerDefinitions(bundle)
  await registration.ready
  const catalog = definitions.defaultOptions().types
  assert.deepEqual(
    catalog.map((type) => type.key),
    ['builtin/vacant', '@test/public/database'],
  )
  assert.equal(definitions.defaultOptions().default_type_key, 'builtin/vacant')
  const inherited = definitions.view({
    id: 'group-1',
    name: 'inherited',
    kind: 'system',
    plugin_id: '@test/public',
    group_key: 'inherited',
    name_i18n: { zh: '继承目录', en: 'Inherited' },
    sort_order: 0,
    definition: {},
  } satisfies GroupRow)
  assert.ok(inherited.types.some((type) => type.key === '@test/public/database'))
  assert.equal(inherited.default_type_key, 'builtin/vacant')
  const explicit = definitions.view({
    id: 'group-2',
    name: 'explicit',
    kind: 'system',
    plugin_id: '@test/public',
    group_key: 'explicit',
    name_i18n: { zh: '显式空置', en: 'Explicit vacant' },
    sort_order: 0,
    definition: {},
  } satisfies GroupRow)
  assert.deepEqual(explicit.types.map((type) => type.key), ['builtin/vacant'])
  await registration.dispose()
  assert.deepEqual(
    definitions.defaultOptions().types.map((type) => type.key),
    ['builtin/vacant'],
  )
  await definitions.close()
})

test('invalid and duplicate public type references fail registration', async () => {
  const definitions = new DefinitionRegistry(fakeDb(), builtinCatalog())
  const missing = definitions.registerDefinitions({
    ...bundle,
    publicTypes: [{ type: '@test/public/missing' }],
  })
  await assert.rejects(missing.ready, { code: 'definition_reference' })
  const duplicate = definitions.registerDefinitions({
    ...bundle,
    publicTypes: [
      { type: '@test/public/database' },
      { type: '@test/public/database' },
    ],
  })
  await assert.rejects(duplicate.ready, { code: 'type_definition_conflict' })
  assert.deepEqual(
    definitions.defaultOptions().types.map((type) => type.key),
    ['builtin/vacant'],
  )
  await definitions.close()
})
