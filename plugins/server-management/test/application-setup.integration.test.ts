import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { Pool } from 'pg'
import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import { builtinCatalog } from '../src/host/definitions/catalog.ts'
import { createServer, enqueueExisting } from '../src/host/servers/service.ts'
import { claimNext, enqueue } from '../src/host/execution/queue.ts'
import { executeJob } from '../src/host/execution/worker.ts'
import { createChangePlan, readChangePlan, confirmChangePlan } from '../src/host/changes/service.ts'
import { LINUX_PROBE } from '../src/host/remote/os-probe.ts'
import type { Db } from '../src/host/database/connection.ts'
import type { SshSession } from '../src/host/remote/ssh.ts'
import { containerRuntimeDefinitions } from '../../container-runtime/src/index.ts'
import { applicationServerDefinitions, applicationServerType } from '../../application-server/src/index.ts'
import { setupApplicationServer } from '../../application-server/src/setup.ts'

test('application enrollment prepares credentials immediately; inspections stay read-only and explicit prepare rotates credentials', { skip: !process.env.SMP_TEST_DATABASE_URL }, async t => {
  const admin = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL })
  const schema = `app_setup_${randomUUID().replaceAll('-', '')}`
  await admin.query(`create schema ${schema}`)
  const pool = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL, options: `-c search_path=${schema}` })
  // The domain Db permits nested transactions on one scoped connection.
  const db: Db = {
    query: async (sql, params) => ({ rows: (await pool.query(sql, params)).rows }),
    async connect() {
      const raw = await pool.connect()
      const scoped = { query: async (sql: string, params?: unknown[]) => ({ rows: (await raw.query(sql, params)).rows }), connect: async () => scoped, release: () => raw.release() }
      return scoped
    },
  }
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  t.after(async () => { await definitions.close(); await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end() })
  const migrations = new URL('../../database/migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => /^\d+_server_/.test(name) || name === '0032_drop_audit_sha256.sql').sort())
    await pool.query(await readFile(new URL(name, migrations), 'utf8'))
  const runtime = definitions.registerDefinitions(containerRuntimeDefinitions)
  await runtime.ready
  let password = 'initial-pull-secret', failLogin = false, missing = false, removals = 0
  let recovered: unknown
  const logins: string[] = []
  const registration = definitions.registerDefinitions(applicationServerDefinitions, applicationServerDefinitions, {
    types: { 'application-server': c => setupApplicationServer(c, { pullLogin: async () => ({ registry: 'registry.invalid', username: 'puller', password }) }) },
  })
  await registration.ready
  const session = {
    fingerprint: 'SHA256:test', close() {},
    async exec(command: string, _timeout: number, options?: { stdin?: string }) {
      const ok = (value: unknown) => ({ code: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' })
      if (command === LINUX_PROBE) return ok('ID=ubuntu\nVERSION_ID="24.04"\nSMP_ARCH=x86_64\n')
      if (!options?.stdin) return ok('')
      const request = JSON.parse(options.stdin)
      if (request.operation === 'detect') return ok({ operation: 'detect', result: missing ? { state: 'missing' } : { state: 'installed', healthy: true, version: '1.0.0', targetIdentity: request.software, packages: [] } })
      if (request.operation === 'list-candidates') return ok({ operation: request.operation, candidates: [{ version: '1.0.0', targetIdentity: request.software, packages: [], channel: 'stable' }] })
      if (request.operation === 'resolve') return ok({ operation: request.operation, additionalRequirements: [], change: {
        software: request.software, recipe: request.recipe, recipeRevision: request.recipeRevision, before: request.installed,
        action: request.action, target: request.target, dependencies: [], effects: [], payload: null,
      } })
      if (request.operation === 'start') {
        missing = false
        recovered = { state: 'completed', steps: request.steps.map((step: { request: { change: { software: string } } }, index: number) => ({
          ordinal: index + 1, software: step.request.change.software, state: 'succeeded', changes: [],
          after: { state: 'installed', healthy: true, version: '1.0.0', targetIdentity: step.request.change.software, packages: [] },
        })) }
        return ok(recovered)
      }
      if (request.operation === 'recover') return ok(recovered)
      if (request.operation === 'remove') { removals++; return ok('{"ok":true}') }
      if (request.operation === 'prepare') {
        assert.equal(missing, false, 'credentials must follow successful Docker installation')
        assert.equal(command.includes(password), false)
        logins.push(request.password)
        return { code: failLogin ? 1 : 0, stdout: failLogin ? password : '{"ok":true}', stderr: '' }
      }
      throw new Error('Unexpected remote request: ' + request.operation)
    },
  } as SshSession
  const deps = { db, definitions, catalog: builtinCatalog(), secrets: { encrypt: (s: string) => s, decrypt: (s: string) => s } }
  const server = await createServer(deps, {
    name: 'application', host: 'example.invalid', region: 'Test', ssh_port: 22, ssh_user: 'root', auth_method: 'password', secret: 'ssh-fixture',
    declared_os: { kind: 'catalog', family: 'builtin/ubuntu', releaseKey: '24.04' },
    type_key: applicationServerType, install_required_software: false, inspect_after_save: false,
  }) as { id: string }
  const runNext = async () => {
    const job = await claimNext(db, 'test-worker')
    assert.ok(job)
    await executeJob(db, deps.secrets, definitions, job, async () => session)
    return (await pool.query('select * from server_jobs where id=$1', [job.id])).rows[0]
  }
  assert.equal((await pool.query('select request_snapshot from server_jobs')).rows[0].request_snapshot.action, 'prepare_type')
  assert.equal((await runNext()).state, 'succeeded')
  assert.deepEqual(logins, ['initial-pull-secret'])
  await enqueue(db, server.id, 'inspect')
  assert.equal((await runNext()).state, 'succeeded')
  assert.equal(logins.length, 1)
  password = 'rotated-pull-secret'
  await enqueueExisting(deps, server.id, 'install_components')
  assert.equal((await runNext()).state, 'succeeded')
  assert.deepEqual(logins, ['initial-pull-secret', 'rotated-pull-secret'])
  failLogin = true
  await enqueueExisting(deps, server.id, 'install_components')
  const failed = await runNext()
  assert.equal(failed.state, 'failed')
  assert.equal(failed.result.error.code, 'type_setup_failed')
  assert.equal(JSON.stringify(failed).includes(password), false)
  // No installed Docker: no secret is sent and the type setup task fails.
  missing = true
  const lease = await definitions.lease(null, applicationServerType)
  assert.ok(lease)
  await enqueue(db, server.id, 'prepare_type', { configRevision: 1, typeSignature: lease.signature })
  lease.release()
  const loginCount = logins.length
  assert.equal((await runNext()).state, 'failed')
  assert.equal(logins.length, loginCount)

  // Installation plans do not contain secrets, and only their successful apply logs in.
  failLogin = false
  await enqueueExisting(deps, server.id, 'install_components')
  assert.equal((await runNext()).state, 'succeeded')
  assert.equal(logins.length, loginCount)
  assert.equal(JSON.stringify((await pool.query('select * from server_change_targets')).rows).includes(password), false)
  assert.equal((await runNext()).state, 'succeeded')
  assert.equal(logins.length, loginCount + 1)

  // A restarted worker must perform setup before reporting a recovered installation successful.
  missing = true
  await enqueueExisting(deps, server.id, 'install_components')
  assert.equal((await runNext()).state, 'succeeded')
  missing = false
  await pool.query("update server_jobs set state='recovering', mutation_phase='installing',worker_id='crashed',fence=1,lease_expires_at=now()-interval '1 second' where purpose='apply_plan' and state='queued'")
  assert.equal((await runNext()).state, 'succeeded')
  assert.equal(logins.length, loginCount + 2)

  const move = async (type: string) => {
    const planId = await createChangePlan(db, definitions, { kind: 'move', server_ids: [server.id], group_id: null, type_key: type, install_missing: false, software_policies: [] })
    assert.equal((await runNext()).state, 'succeeded')
    const plan = await readChangePlan(db, planId)
    await confirmChangePlan(db, planId, { revision: plan.revision, review_digest: plan.review_digest, start: new Date().toISOString(), end: new Date(Date.now() + 60_000).toISOString(), timezone: 'UTC', concurrency: 1 })
    return runNext()
  }
  assert.equal((await move('builtin/vacant')).state, 'succeeded')
  assert.equal(removals, 1)
  failLogin = true
  assert.equal((await move(applicationServerType)).state, 'failed')
  assert.equal((await pool.query('select type_key from servers where id=$1', [server.id])).rows[0].type_key, 'builtin/vacant')
  failLogin = false
  assert.equal((await move(applicationServerType)).state, 'succeeded')
  assert.equal((await pool.query('select type_key from servers where id=$1', [server.id])).rows[0].type_key, applicationServerType)
})
