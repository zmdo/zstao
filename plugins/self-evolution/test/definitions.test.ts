import assert from 'node:assert/strict'
import test from 'node:test'
import { builtinCatalog } from '../../server-management/src/host/definitions/catalog.ts'
import { DefinitionRegistry } from '../../server-management/src/host/definitions/registry.ts'
import type { Db } from '../../server-management/src/host/database/connection.ts'
import type { GroupRow } from '../../server-management/src/host/groups/persistence/rows.ts'
import { selfEvolutionDefinitions } from '../src/index.ts'
import { containerRuntimeDefinitions } from '../../container-runtime/src/index.ts'

test('self-evolution defines one system group with three dedicated server types', () => {
  assert.equal(selfEvolutionDefinitions.contractVersion, 2)
  assert.equal(selfEvolutionDefinitions.owner, '@smp/console-self-evolution')
  assert.deepEqual(
    selfEvolutionDefinitions.types?.map((type) => type.key),
    ['infrastructure', 'test', 'host'],
  )
  assert.deepEqual(
    selfEvolutionDefinitions.types?.map((type) => type.name.zh),
    ['自演进基础设施服务器', '自演进测试服务器', '自演进宿主服务器'],
  )
  assert.equal(selfEvolutionDefinitions.types?.[0]?.requirements.length, 4)
  assert.equal(selfEvolutionDefinitions.types?.[1]?.requirements.length, 5)
  assert.equal(selfEvolutionDefinitions.types?.[2]?.requirements.length, 5)
  assert.deepEqual(selfEvolutionDefinitions.publicTypes, undefined)
  assert.equal(selfEvolutionDefinitions.groups?.length, 1)
  assert.deepEqual(selfEvolutionDefinitions.groups?.[0], {
    key: 'self-evolution',
    name: { zh: '自演进组', en: 'Self-evolution' },
    order: 10,
    types: [
      '@smp/console-self-evolution/infrastructure',
      '@smp/console-self-evolution/test',
      '@smp/console-self-evolution/host',
    ],
    defaultType: '@smp/console-self-evolution/infrastructure',
  })
})

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

function groupRow(id: string): GroupRow {
  return {
    id,
    name: '自演进组',
    kind: 'system',
    plugin_id: '@smp/console-self-evolution',
    group_key: 'self-evolution',
    name_i18n: { zh: '自演进组', en: 'Self-evolution' },
    sort_order: 10,
    definition: {},
  }
}

test('the three special types are visible only in the self-evolution group', async () => {
  const definitions = new DefinitionRegistry(fakeDb(), builtinCatalog())
  const runtimeRegistration = definitions.registerDefinitions(containerRuntimeDefinitions)
  await runtimeRegistration.ready
  const registration = definitions.registerDefinitions(selfEvolutionDefinitions)
  await registration.ready
  const group = definitions.view(groupRow('group-1'))
  assert.deepEqual(
    group.types.map((type) => type.key),
    [
      '@smp/console-self-evolution/infrastructure',
      '@smp/console-self-evolution/test',
      '@smp/console-self-evolution/host',
    ],
  )
  assert.equal(group.default_type_key, '@smp/console-self-evolution/infrastructure')
  assert.deepEqual(
    definitions.defaultOptions().types.map((type) => type.key),
    ['builtin/vacant'],
  )
  await registration.dispose()
  await runtimeRegistration.dispose()
  await definitions.close()
})
