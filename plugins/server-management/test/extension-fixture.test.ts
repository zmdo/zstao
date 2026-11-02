import assert from 'node:assert/strict'
import test from 'node:test'
import type { Db } from '../src/host/database/connection.ts'
import { builtinCatalog } from '../src/host/definitions/catalog.ts'
import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import { ServerExtensionRegistry } from '../src/host/extensions/registry.ts'
import type { ServerDto } from '../src/shared/dto/servers.ts'
import type { SlotService } from '../src/client/extensions/slots.ts'
import { fixtureDefinitions, fixtureExtension, fixtureRuntime, fixtureType } from './fixtures/extension-fixture.ts'
import { registerFixtureClient } from './fixtures/extension-fixture-client.ts'
import { runExtensionInspections } from '../src/host/extensions/inspect.ts'
import type { InspectionContext } from '../src/host/extensions/inspect.ts'
import { inspectionJob } from './fixtures/inspection-job.ts'

function fakeDb(): Db {
  const client = {
    async query() {
      return { rows: [] }
    },
    release() {},
  }
  return { connect: async () => client } as unknown as Db
}

function server(type_key: string): ServerDto {
  return { type_key } as ServerDto
}

test('the formal fixture contributes one database panel, setting, query and inspection', async () => {
  const definitions = new DefinitionRegistry(fakeDb(), builtinCatalog())
  const definitionsRegistration = definitions.registerDefinitions(fixtureDefinitions)
  await definitionsRegistration.ready
  const extensions = new ServerExtensionRegistry(definitions)
  let committed: unknown
  const runtime = {
    ...fixtureRuntime,
    inspections: {
      'database-check': {
        ...fixtureRuntime.inspections!['database-check']!,
        async commit(_db: unknown, server: unknown, result: unknown) {
          committed = { server, result }
        },
      },
    },
  }
  const registration = extensions.registerExtensions(fixtureExtension, fixtureExtension, runtime)
  await registration.ready
  assert.deepEqual(
    extensions.catalogFor(server('builtin/vacant')).map((entry) => entry.key),
    [],
  )
  assert.deepEqual(
    extensions.catalogFor(server(fixtureType)).map((entry) => `${entry.kind}:${entry.key}`),
    [
      'inspection:@test/extension-fixture/database-check',
      'panel:@test/extension-fixture/database-panel',
      'settings:@test/extension-fixture/database-settings',
      'query:@test/extension-fixture/database-status',
    ],
  )
  assert.deepEqual(await extensions.runQuery(server(fixtureType), '@test/extension-fixture/database-status', new URLSearchParams()), { online: true })
  assert.deepEqual(extensions.settings(server(fixtureType), '@test/extension-fixture/database-settings').runtime.defaults, {
    collect: true,
  })
  const inspection = extensions.inspection('@test/extension-fixture/database-check')
  assert.ok(inspection)
  assert.match(inspection.script.body, /ok/)
  await assert.rejects(
    extensions.runQuery(server('builtin/vacant'), '@test/extension-fixture/database-status', new URLSearchParams()),
    { code: 'extension_unavailable' },
  )
  await registration.dispose()
  await definitionsRegistration.dispose()
  extensions.close()
  await definitions.close()
})

test('the fixture registers components through the public slot helpers', () => {
  const registered: { name: string; key: string }[] = []
  const slots: SlotService = {
    inject(_name, register) {
      register()
    },
    register(options) {
      const value = options as { name: string; key: string }
      registered.push(value)
      return () => {}
    },
    entriesOfSlot() {
      return []
    },
    subscribe() {
      return () => {}
    },
  }
  registerFixtureClient(slots)
  assert.deepEqual(registered, [
    { name: 'server-management.detail.panel', key: 'database-panel', priority: 0 },
    { name: 'server-management.settings.section', key: 'database-settings', priority: 0 },
  ])
})


test('the core inspect path executes a fixture script and stores an extension observation', async () => {
  const captured: unknown[][] = []
  const client = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('insert into server_extension_observations')) {
        captured.push(params ?? [])
        return { rows: [] }
      }
      if (sql.includes('from server_jobs')) return { rows: [{ id: 'job-1' }] }
      if (sql.includes('from servers')) return { rows: [{ id: 'server-1' }] }
      return { rows: [] }
    },
    release() {},
  }
  const db = { connect: async () => client, query: client.query.bind(client) } as unknown as Db
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  const definitionsRegistration = definitions.registerDefinitions(fixtureDefinitions)
  await definitionsRegistration.ready
  const extensions = new ServerExtensionRegistry(definitions)
  let committed: unknown
  const runtime = {
    ...fixtureRuntime,
    inspections: {
      'database-check': {
        ...fixtureRuntime.inspections!['database-check']!,
        async commit(_db: unknown, server: unknown, result: unknown) {
          committed = { server, result }
        },
      },
    },
  }
  const registration = extensions.registerExtensions(fixtureExtension, fixtureExtension, runtime)
  await registration.ready
  const context = {
    db,
    job: inspectionJob(),
    server: {
      id: 'server-1', host: 'test', ssh_port: 22, ssh_user: 'test',
      type_key: fixtureType,
      declared_os: { kind: 'custom', text: 'test' },
      config_revision: '1',
    },
    session: {
      async exec() {
        return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
      },
    },
    guard: async () => {},
  } satisfies InspectionContext
  const results = await runExtensionInspections(context, extensions)
  assert.equal(results.length, 1)
  assert.equal(results[0]?.status, 'succeeded')
  assert.deepEqual(results[0]?.result, { ok: true })
  assert.equal(captured.length, 1)
  assert.equal(captured[0]?.[3], 'succeeded')
  assert.deepEqual((committed as { server: { id: string; type_key: string }; result: unknown }).result, { ok: true })
  assert.equal((committed as { server: { id: string; type_key: string } }).server.id, 'server-1')
  assert.equal((committed as { server: { type_key: string } }).server.type_key, fixtureType)
  await registration.dispose()
  await definitionsRegistration.dispose()
  extensions.close()
  await definitions.close()
})

test('a disabled extension setting skips the inspection script', async () => {
  const client = {
    async query(sql: string) {
      if (sql.includes('from server_extension_settings'))
        return { rows: [{ value: { collect: false }, revision: '1' }] }
      if (sql.includes('from server_jobs')) return { rows: [{ id: 'job-1' }] }
      if (sql.includes('from servers')) return { rows: [{ id: 'server-1' }] }
      return { rows: [] }
    },
    release() {},
  }
  const db = { connect: async () => client, query: client.query.bind(client) } as unknown as Db
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  const definitionsRegistration = definitions.registerDefinitions(fixtureDefinitions)
  await definitionsRegistration.ready
  const extensions = new ServerExtensionRegistry(definitions)
  const registration = extensions.registerExtensions(fixtureExtension, fixtureExtension, fixtureRuntime)
  await registration.ready
  let executed = 0
  const context = {
    db,
    job: inspectionJob(),
    server: { id: 'server-1', host: 'test', ssh_port: 22, ssh_user: 'test', type_key: fixtureType, declared_os: { kind: 'custom', text: 'test' }, config_revision: '1' },
    session: {
      async exec() {
        executed += 1
        return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
      },
    },
    guard: async () => {},
  } satisfies InspectionContext
  assert.deepEqual(await runExtensionInspections(context, extensions), [])
  assert.equal(executed, 0)
  await registration.dispose()
  await definitionsRegistration.dispose()
  extensions.close()
  await definitions.close()
})

test('a provider that unloads during the script cannot publish a success observation', async () => {
  const captured: unknown[][] = []
  const client = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('insert into server_extension_observations')) {
        captured.push(params ?? [])
        return { rows: [] }
      }
      if (sql.includes('from server_jobs')) return { rows: [{ id: 'job-1' }] }
      if (sql.includes('from servers')) return { rows: [{ id: 'server-1' }] }
      return { rows: [] }
    },
    release() {},
  }
  const db = { connect: async () => client, query: client.query.bind(client) } as unknown as Db
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  const definitionsRegistration = definitions.registerDefinitions(fixtureDefinitions)
  await definitionsRegistration.ready
  const extensions = new ServerExtensionRegistry(definitions)
  const registration = extensions.registerExtensions(fixtureExtension, fixtureExtension, fixtureRuntime)
  await registration.ready
  const context = {
    db,
    job: inspectionJob(),
    server: { id: 'server-1', host: 'test', ssh_port: 22, ssh_user: 'test', type_key: fixtureType, declared_os: { kind: 'custom', text: 'test' }, config_revision: '1' },
    session: {
      async exec() {
        await registration.dispose()
        return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
      },
    },
    guard: async () => {},
  } satisfies InspectionContext
  const results = await runExtensionInspections(context, extensions)
  assert.equal(results.length, 1)
  assert.equal(results[0]?.status, 'failed')
  assert.equal(captured.length, 1)
  assert.equal(captured[0]?.[3], 'failed')
  await definitionsRegistration.dispose()
  extensions.close()
  await definitions.close()
})

test('a setting revision change during the script rejects the success observation', async () => {
  const captured: unknown[][] = []
  let changed = false
  const client = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('from server_extension_settings'))
        return { rows: [{ value: { collect: true }, revision: changed ? '2' : '1' }] }
      if (sql.includes('insert into server_extension_observations')) {
        captured.push(params ?? [])
        return { rows: [] }
      }
      if (sql.includes('from server_jobs')) return { rows: [{ id: 'job-1' }] }
      if (sql.includes('from servers')) return { rows: [{ id: 'server-1' }] }
      return { rows: [] }
    },
    release() {},
  }
  const db = { connect: async () => client, query: client.query.bind(client) } as unknown as Db
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  const definitionsRegistration = definitions.registerDefinitions(fixtureDefinitions)
  await definitionsRegistration.ready
  const extensions = new ServerExtensionRegistry(definitions)
  const registration = extensions.registerExtensions(fixtureExtension, fixtureExtension, fixtureRuntime)
  await registration.ready
  const context = {
    db,
    job: inspectionJob(),
    server: { id: 'server-1', host: 'test', ssh_port: 22, ssh_user: 'test', type_key: fixtureType, declared_os: { kind: 'custom', text: 'test' }, config_revision: '1' },
    session: {
      async exec() {
        changed = true
        return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
      },
    },
    guard: async () => {},
  } satisfies InspectionContext
  const results = await runExtensionInspections(context, extensions)
  assert.equal(results[0]?.status, 'failed')
  assert.equal((results[0]?.error as { code?: string }).code, 'extension_inspection_setting_changed')
  assert.equal(captured[0]?.[3], 'failed')
  await registration.dispose()
  await definitionsRegistration.dispose()
  extensions.close()
  await definitions.close()
})

test('a lost fence prevents publishing observations', async () => {
  const captured: unknown[][] = []
  const client = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('insert into server_extension_observations')) {
        captured.push(params ?? [])
        return { rows: [] }
      }
      if (sql.includes('from server_jobs')) return { rows: [] }
      if (sql.includes('from servers')) return { rows: [{ id: 'server-1' }] }
      return { rows: [] }
    },
    release() {},
  }
  const db = { connect: async () => client, query: async () => ({ rows: [] }) } as unknown as Db
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  const definitionsRegistration = definitions.registerDefinitions(fixtureDefinitions)
  await definitionsRegistration.ready
  const extensions = new ServerExtensionRegistry(definitions)
  const registration = extensions.registerExtensions(fixtureExtension, fixtureExtension, fixtureRuntime)
  await registration.ready
  const context = {
    db,
    job: inspectionJob(),
    server: { id: 'server-1', host: 'test', ssh_port: 22, ssh_user: 'test', type_key: fixtureType, declared_os: { kind: 'custom', text: 'test' }, config_revision: '1' },
    session: { async exec() { return { code: 0, stdout: '{"ok":true}\n', stderr: '' } } },
    guard: async () => {},
  } satisfies InspectionContext
  await assert.rejects(runExtensionInspections(context, extensions), { code: 'job_lease_lost' })
  assert.equal(captured.length, 0)
  await registration.dispose()
  await definitionsRegistration.dispose()
  extensions.close()
  await definitions.close()
})
