import assert from 'node:assert/strict'
import test from 'node:test'
import type { Db, DbClient } from '../src/host/database/connection.ts'
import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import { builtinCatalog } from '../src/host/definitions/catalog.ts'
import { ServerExtensionRegistry } from '../src/host/extensions/registry.ts'
import { runExtensionInspections, type InspectionContext } from '../src/host/extensions/inspect.ts'
import { fixtureDefinitions, fixtureExtension, fixtureRuntime, fixtureType } from './fixtures/extension-fixture.ts'
import { inspectionJob } from './fixtures/inspection-job.ts'

async function fixture(t: test.TestContext) {
  let revision = '1', collect = true
  let connect = async () => {}
  let observations: unknown[][] = [], pending: unknown[][] = []
  const client: DbClient = {
    async query<T>(sql: string, params: unknown[] = []) {
      let rows: unknown[] = []
      if (sql === 'begin') pending = []
      if (sql === 'commit') observations.push(...pending)
      if (sql.includes('from server_jobs')) rows = [{ id: 'job-1' }]
      if (sql.includes('from servers')) rows = [{ id: 'server-1' }]
      if (sql.includes('from server_extension_settings')) rows = [{ value: { collect }, revision }]
      if (sql.includes('insert into server_extension_observations')) pending.push(params)
      return { rows: rows as T[] }
    },
    async connect() { return client }, release() {},
  }
  const db: Db = { query: client.query, async connect() { await connect(); return client } }
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  const types = definitions.registerDefinitions(fixtureDefinitions)
  await types.ready
  const extensions = new ServerExtensionRegistry(definitions)
  let commits = 0
  let onCommit = async () => {}
  const runtime = { ...fixtureRuntime, inspections: { 'database-check': {
    ...fixtureRuntime.inspections!['database-check']!, async commit() { commits++; await onCommit() },
  } } }
  const registration = extensions.registerExtensions(fixtureExtension, {}, runtime)
  await registration.ready
  const context: InspectionContext = {
    db, job: inspectionJob(), guard: async () => {},
    server: { id: 'server-1', host: 'test', ssh_port: 22, ssh_user: 'test', type_key: fixtureType,
      declared_os: { kind: 'custom', text: 'test' }, config_revision: '1' },
    session: { async exec() { return { code: 0, stdout: '{"ok":true}', stderr: '' } } },
  }
  t.after(async () => { await extensions.close(); await types.dispose(); await definitions.close() })
  return { context, extensions, registration, runtime,
    observations: () => observations, commits: () => commits,
    setRevision: (value: string) => { revision = value }, disable: () => { collect = false },
    onConnect: (fn: () => Promise<void>) => { connect = fn },
    onCommit: (fn: () => Promise<void>) => { onCommit = fn },
  }
}

test('same-key reload cannot validate or commit the previous script output', async (t) => {
  const f = await fixture(t)
  let newValidatorCalled = false
  f.context.session.exec = async () => {
    await f.registration.dispose()
    await f.extensions.registerExtensions(fixtureExtension, {}, {
      ...f.runtime, inspections: { 'database-check': { validate() { newValidatorCalled = true; return {} } } },
    }).ready
    return { code: 0, stdout: '{"ok":true}', stderr: '' }
  }
  const results = await runExtensionInspections(f.context, f.extensions)
  assert.equal(results[0]?.status, 'failed')
  assert.equal(newValidatorCalled, false)
  assert.equal(f.commits(), 0)
  assert.equal(f.observations()[0]?.[3], 'failed')
})

test('configuration changed while waiting for the commit connection rejects the snapshot', async (t) => {
  const f = await fixture(t)
  f.onConnect(async () => { f.setRevision('2') })
  const results = await runExtensionInspections(f.context, f.extensions)
  assert.equal((results[0]?.error as { code: string }).code, 'extension_inspection_setting_changed')
  assert.equal(f.commits(), 0)
  assert.equal(f.observations()[0]?.[3], 'failed')
})

test('withdrawal drains a running commit and rolls its observation back', async (t) => {
  const f = await fixture(t)
  let disposed = false
  let disposal: Promise<void> | undefined
  f.onCommit(async () => {
    disposal = f.registration.dispose().then(() => { disposed = true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(disposed, false)
  })
  const result = await runExtensionInspections(f.context, f.extensions)
  await disposal
  assert.equal(disposed, true)
  assert.equal(result[0]?.status, 'failed')
  assert.deepEqual(f.observations().map((row) => row[3]), ['failed'])
})

test('manual inspection still collects when periodic collection is disabled', async (t) => {
  const f = await fixture(t)
  f.disable()
  assert.deepEqual(await runExtensionInspections(f.context, f.extensions), [])
  f.context.job.request_snapshot.source = 'manual'
  assert.equal((await runExtensionInspections(f.context, f.extensions))[0]?.status, 'succeeded')
  assert.equal(f.commits(), 1)
})
