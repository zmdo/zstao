import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pool } from 'pg'
import { AdminRuntime } from '../src/host/admin/runtime.ts'
import { registerServerTools } from '../src/host/harness/tools.ts'
import { permissionFixture } from './fixtures/permissions.ts'
import { executeAdmin, type AdminTool } from '../src/host/admin/service.ts'
import { type AdminContext, type AdminDeps } from '../src/host/admin/model.ts'
import { mutate } from '../src/host/admin/approval.ts'
import { serverSnapshot } from '../src/host/admin/persistence/repository.ts'
import { scheduledRetention } from '../src/host/admin/retention.ts'
import { generateKey, publicKey } from '../src/host/admin/keys.ts'
import { transaction } from '../src/host/database/transaction.ts'
import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import { builtinCatalog } from '../src/host/definitions/catalog.ts'
import { ServerExtensionRegistry } from '../src/host/extensions/registry.ts'
import { Enrollment } from '../src/host/servers/enrollment.ts'
import {
  createServer as registerServer,
  deleteServer,
  updateServer,
} from '../src/host/servers/service.ts'
import { createKey, deleteKey } from '../src/host/keys/service.ts'
import { readChangePlan } from '../src/host/changes/service.ts'
import { draftResult, planResult } from '../src/host/admin/guidance.ts'
import type { TypeOptions } from '../src/shared/definitions.ts'
import { nextCandidate, tryLockServer } from '../src/host/execution/persistence/repository.ts'
import { registerRoutes, type HttpHost } from '../src/host/http/routes.ts'
import { SecretsCodec } from '../../database/src/fernet.ts'
import type { Db, DbClient } from '../src/host/database/connection.ts'

function database(pool: Pool): Db {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return { rows: (await pool.query(sql, params)).rows as T[] }
    },
    async connect() {
      const client = await pool.connect()
      const scoped: DbClient = {
        async query<T>(sql: string, params?: unknown[]) {
          return { rows: (await client.query(sql, params)).rows as T[] }
        },
        async connect() {
          return scoped
        },
        release() {
          client.release()
        },
      }
      return scoped
    },
  }
}

test(
  'single-user administration shares domain protections and commits approval audit atomically',
  { skip: !process.env.SMP_TEST_DATABASE_URL, timeout: 60000 },
  async (t) => {
    const owner = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL })
    const schema = `admin_${randomUUID().replaceAll('-', '')}`
    await owner.query(`create schema ${schema}`)
    const pool = new Pool({
      connectionString: process.env.SMP_TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    })
    const db = database(pool)
    const migrations = new URL('../../database/migrations/', import.meta.url)
    for (const name of (await readdir(migrations))
      .filter((name) => /^\d+_server_/.test(name) || name === '0032_drop_audit_sha256.sql')
      .sort()) {
      await pool.query(await readFile(new URL(name, migrations), 'utf8'))
    }
    await pool.query(
      "create table accounts(id uuid primary key,username text not null); insert into accounts values(gen_random_uuid(),'owner')",
    )
    const secrets = new SecretsCodec(Buffer.alloc(32, 4))
    const catalog = builtinCatalog(),
      definitions = new DefinitionRegistry(db, catalog)
    const extensions = new ServerExtensionRegistry(definitions),
      enrollment = new Enrollment({ db, secrets, definitions })
    const deps: AdminDeps = { db, secrets, catalog, definitions, extensions, enrollment }
    t.after(async () => {
      await enrollment.close()
      await extensions.close()
      await definitions.close()
      await pool.end()
      await owner.query(`drop schema ${schema} cascade`)
      await owner.end()
    })
    let approvals = 0,
      preview = '',
      decision = 'allowed-once',
      during: (() => Promise<void>) | undefined
    const context = (): AdminContext => ({
      agent: { id: 'session-fixture' },
      callId: randomUUID(),
      signal: new AbortController().signal,
      approval: {
        async request(request) {
          approvals++
          preview = request.reason ?? ''
          await during?.()
          return decision
        },
      },
    })
    const call = (tool: AdminTool, action: string, input: Record<string, unknown>) =>
      executeAdmin(deps, context(), tool, action, input)
    const makeKey = async () =>
      createKey(deps, { name: 'fixture', secret: generateKey().private }) as Promise<{
        id: string
        fingerprint: string
      }>
    const makeServer = async (key?: string) => {
      const row = (await registerServer(deps, {
        name: randomUUID(),
        host: randomUUID() + '.invalid',
        region: 'Test',
        ssh_port: 22,
        ssh_user: 'ops',
        auth_method: key ? 'private_key' : 'password',
        ssh_key_id: key,
        secret: key ? undefined : 'fixture-password',
        declared_os: { kind: 'custom', text: 'test' },
        type_key: 'builtin/vacant',
      })) as { id: string }
      await pool.query("update servers set host_fingerprint='SHA256:fixture' where id=$1", [row.id])
      return row.id
    }

    await t.test('registered admin, command and transfer tools honor real host full access and record its authorization source', async t => {
      const f = await permissionFixture(t)
      const runtime = new AdminRuntime(deps)
      const release = runtime.registerForAgent(f.agent, async () => {})
      let connections = 0
      let stopTransfer = false
      const harness = await f.ctx.plugin(Object.assign((scope: typeof f.ctx) => registerServerTools(scope, {
        ...deps,
        secrets: { decrypt(value) { if (stopTransfer) throw new Error('transfer-execution-reached'); return secrets.decrypt(value) } },
        connect: async () => { connections++; return { exec: async () => ({ code: 0, stdout: 'fixture', stderr: '' }), close() {} } as never },
      }), { inject: ['tools'] }))
      const invoke = (name: string, args: Record<string, unknown>) => f.ctx.tools.execute({
        name, arguments: args, agent: f.agent, callId: randomUUID() as never, signal: new AbortController().signal,
      })
      const adminCall = async (name: string, action: string, input: Record<string, unknown>) => {
        const result = await invoke(name, { action, input })
        assert.equal(result.isError, false, JSON.stringify(result.content))
        if (result.isError) throw new Error('unreachable failed tool')
        return JSON.parse(String(result.value))
      }
      try {
        f.set('danger-full-access')
        const key = await makeKey(), server = await makeServer(key.id)
        const group = await adminCall('platform_server_group_admin', 'create', { name: 'Full access fixture' })
        await adminCall('platform_server_admin', 'update', { server, expected_config_revision: '1', patch: { region: 'Updated' } })
        const revision = (await serverSnapshot(db, server)).config_revision
        const draft = await adminCall('platform_server_admin', 'rebind', { server, expected_config_revision: revision, target_group: group.id, install_missing: false, software_policies: [] })
        assert.equal(draft.requires_approval, false)
        await pool.query("update server_change_targets set preflight_state='ready',target_snapshot=$2 where plan_id=$1", [draft.plan_id, { changes: [] }])
        await pool.query("update server_change_plans set state='awaiting_confirmation' where id=$1", [draft.plan_id])
        const plan = await adminCall('platform_server_upgrade_admin', 'show', { plan_id: draft.plan_id })
        const scheduled = await adminCall('platform_server_upgrade_admin', 'apply', {
          plan_id: plan.id, revision: plan.revision, review_digest: plan.review_digest,
          start: new Date().toISOString(), end: new Date(Date.now() + 60000).toISOString(), timezone: 'UTC',
        })
        assert.equal(scheduled.state, 'scheduled')
        await adminCall('platform_server_upgrade_admin', 'cancel', { plan_id: plan.id })
        assert.equal((await invoke('platform_server_exec', { server, command: 'fixture-command' })).isError, false)
        assert.equal(connections, 1)
        stopTransfer = true
        const transfer = await invoke('platform_server_rsync', { server, command: `rsync /tmp/fixture ${(await serverSnapshot(db, server)).host}:/tmp/fixture` })
        assert.equal(transfer.isError, true)
        assert.match(JSON.stringify(transfer.content), /transfer-execution-reached/)
        assert.equal(f.prompts(), 0)
        const records = (await pool.query('select * from server_audit_log where harness_session_id=$1', [f.session.id])).rows
        assert.ok(records.length >= 6)
        for (const row of records) {
          assert.equal(row.permission_mode, 'danger-full-access')
          assert.equal(row.approval_status, 'not_required')
          assert.equal(row.metadata.authorization_source, 'full-access')
          assert.equal(row.approved_at, null)
          assert.equal(row.approved_by, null)
          assert.equal(row.approval_id, null)
        }
        const stale = await invoke('platform_server_admin', { action: 'update', input: { server, expected_config_revision: '999', patch: { region: 'Stale' } } })
        assert.equal(stale.isError, true)
        assert.match(JSON.stringify(stale.content), /server_revision_conflict/)
        f.set('workspace-write'); f.answer('rejected')
        const denied = await invoke('platform_server_admin', { action: 'update', input: { server, expected_config_revision: revision, patch: { region: 'Denied' } } })
        assert.equal(denied.isError, true)
        assert.match(JSON.stringify(denied.content), /approval_denied/)
        assert.equal((await serverSnapshot(db, server)).region, 'Updated')
        const commandDenied = await invoke('platform_server_exec', { server, command: 'fixture-command' })
        assert.equal(commandDenied.isError, true)
        assert.equal(connections, 1)
        assert.equal(f.prompts(), 2)
        f.set('danger-full-access')
        const directory = await mkdtemp(join(tmpdir(), 'smp-full-access-retention-'))
        t.after(() => rm(directory, { recursive: true, force: true }))
        const retention = await adminCall('platform_audit_admin', 'retention', { mode: 'set', days: 30, archive_directory: directory, next_run: new Date(Date.now() + 3600000).toISOString(), enabled: true })
        assert.equal(retention.authorization_source, 'full-access')
        await pool.query("update server_audit_retention set next_run=now()-interval '1 second'")
        await scheduledRetention(db, new AbortController().signal)
        const automatic = (await pool.query("select * from server_audit_log where actor_kind='system' order by created_at desc limit 1")).rows[0]
        assert.equal(automatic.approval_status, 'not_required')
        assert.equal(automatic.metadata.authorization_source, 'full-access')
        assert.equal(automatic.metadata.authorization_call_id, retention.approval_id)
        assert.equal(automatic.approval_id, null)
        await deleteServer(db, server)
        await deleteKey(db, key.id)
        f.set('danger-full-access')
        await adminCall('platform_server_group_admin', 'delete', { group_id: group.id })
      } finally {
        await harness.dispose(); release(); await runtime.close()
      }
    })

    await t.test(
      'denied and unavailable approval perform no writes; caller cannot self-approve',
      async () => {
        decision = 'denied'
        await assert.rejects(
          call('platform_server_group_admin', 'create', { name: 'denied' }),
          /approval_denied/,
        )
        await assert.rejects(
          executeAdmin(
            deps,
            { ...context(), approval: undefined },
            'platform_server_group_admin',
            'create',
            { name: 'unavailable' },
          ),
          /approval_denied/,
        )
        await assert.rejects(
          call('platform_server_group_admin', 'create', { name: 'override', approved: true }),
          /invalid_request/,
        )
        assert.equal(
          (
            await pool.query(
              "select count(*)::int as n from server_groups where name in ('denied','unavailable','override')",
            )
          ).rows[0].n,
          0,
        )
        assert.equal(
          (
            await pool.query(
              "select count(*)::int as n from server_audit_log where status='denied' and harness_session_id='session-fixture'",
            )
          ).rows[0].n,
          2,
        )
        decision = 'allowed-once'
      },
    )
    await t.test(
      'groups protect system ownership, allow vacant unbinding and freeze membership',
      async () => {
        const group = (await call('platform_server_group_admin', 'create', {
          name: 'test group',
        })) as { id: string }
        await call('platform_server_group_admin', 'rename', { group_id: group.id, name: 'renamed' })
        const server = await makeServer()
        await pool.query('update servers set group_id=$2 where id=$1', [server, group.id])
        during = async () => {
          await pool.query('update servers set name=$2 where id=$1', [
            server,
            'changed while approving',
          ])
        }
        await assert.rejects(
          call('platform_server_group_admin', 'delete', { group_id: group.id }),
          /server_revision_conflict/,
        )
        during = undefined
        await call('platform_server_group_admin', 'delete', { group_id: group.id })
        assert.deepEqual(
          (
            await pool.query('select group_id,config_revision::text from servers where id=$1', [
              server,
            ])
          ).rows[0],
          { group_id: null, config_revision: '2' },
        )
        const system = randomUUID()
        await pool.query(
          "insert into server_groups(id,name,kind,plugin_id,group_key,name_i18n) values($1,'system','system','fixture','fixture','{}')",
          [system],
        )
        await assert.rejects(
          call('platform_server_group_admin', 'rename', { group_id: system, name: 'no' }),
          (error) => (error as { code: string }).code === 'system_group_protected',
        )
      },
    )
    await t.test('audit insertion failure rolls back nested domain mutation', async () => {
      const server = await makeServer()
      await assert.rejects(
        mutate(
          deps,
          context(),
          'platform_server_admin',
          'update',
          server,
          (c, lock) => serverSnapshot(c, server, lock),
          async (c) => {
            await transaction(c, async (nested) => {
              await nested.query('update servers set name=$2 where id=$1', [
                server,
                'must roll back',
              ])
            })
            return { cannotSerialize: 1n }
          },
          {},
        ),
        /BigInt/,
      )
      assert.notEqual(
        (await pool.query('select name from servers where id=$1', [server])).rows[0].name,
        'must roll back',
      )
      assert.equal(
        (
          await pool.query(
            "select status from server_audit_log where metadata->>'target_id'=$1 order by created_at desc limit 1",
            [server],
          )
        ).rows[0].status,
        'failed',
      )
    })
    await t.test(
      'server edits reject stale revisions and metadata drift and queue credential retests',
      async () => {
        const key = await makeKey(),
          server = await makeServer(key.id)
        const input = { server, expected_config_revision: '1', patch: { name: 'approved name' } }
        await assert.rejects(
          call('platform_server_admin', 'update', { ...input, expected_config_revision: '2' }),
          /server_revision_conflict/,
        )
        during = async () => {
          await pool.query("update servers set region='elsewhere' where id=$1", [server])
        }
        await assert.rejects(
          call('platform_server_admin', 'update', input),
          /server_revision_conflict/,
        )
        during = undefined
        const before = approvals
        await call('platform_server_admin', 'update', input)
        assert.equal(approvals - before, 1)
        assert.equal(
          (await pool.query('select config_revision::text from servers where id=$1', [server]))
            .rows[0].config_revision,
          '1',
        )
        const changed = (await call('platform_server_admin', 'update', {
          server,
          expected_config_revision: '1',
          patch: { ssh_port: 2222 },
        })) as { connection_test: { id: string } }
        assert.ok(changed.connection_test.id)
        assert.equal(
          (await pool.query('select config_revision::text from servers where id=$1', [server]))
            .rows[0].config_revision,
          '2',
        )
        await assert.rejects(
          call('platform_server_admin', 'update', {
            server,
            expected_config_revision: '2',
            patch: { secret: 'forbidden' },
          }),
          /invalid_request/,
        )
        await assert.rejects(
          call('platform_server_key_admin', 'delete', { key_id: key.id }),
          (error) => (error as { code: string }).code === 'key_in_use',
        )
      },
    )
    await t.test(
      'plan creation and apply each approve once and bind digest, risk and maintenance window',
      async () => {
        const server = await makeServer()
        const before = approvals
        const options = await call('platform_server_group_admin', 'types', { group_id: null }) as TypeOptions
        assert.ok(options.available)
        assert.ok(options.types.some(type => type.key === options.default_type_key))
        const jobCount = async () => (await pool.query('select count(*) from server_jobs where server_id=$1', [server])).rows[0].count
        const jobsBefore = await jobCount()
        const suggestions = await call('platform_server_upgrade_admin', 'suggestions', { server }) as { queued: boolean; items: unknown[]; checks: unknown[] }
        assert.equal(suggestions.queued, false)
        assert.ok(Array.isArray(suggestions.items) && Array.isArray(suggestions.checks))
        assert.equal(await jobCount(), jobsBefore)
        assert.equal(approvals, before)
        const created = (await call('platform_server_admin', 'rebind', {
          server,
          expected_config_revision: '1',
          target_group: null,
          target_type: options.default_type_key,
          install_missing: false,
          software_policies: [],
        })) as ReturnType<typeof draftResult>
        assert.equal(approvals - before, 1)
        assert.equal(created.next_step.tool, 'platform_server_upgrade_admin')
        const pending = await call('platform_server_upgrade_admin', created.next_step.arguments.action, created.next_step.arguments.input) as ReturnType<typeof planResult>
        assert.equal(pending.state, 'draft')
        assert.equal(pending.next_step?.arguments && 'action' in pending.next_step.arguments && pending.next_step.arguments.action, 'show')
        let plan = await readChangePlan(db, created.plan_id)
        const window = {
          start: new Date().toISOString(),
          end: new Date(Date.now() + 3600000).toISOString(),
          timezone: 'Asia/Shanghai',
        }
        await assert.rejects(
          call('platform_server_upgrade_admin', 'apply', {
            plan_id: plan.id,
            revision: String(plan.revision),
            review_digest: plan.review_digest,
            ...window,
          }),
          (error) => (error as { code: string }).code === 'plan_not_ready',
        )
        await pool.query(
          "update server_change_targets set preflight_state='ready',target_snapshot=$2 where plan_id=$1",
          [
            plan.id,
            {
              changes: [
                {
                  action: 'replace',
                  software: 'fixture/database',
                  effects: [{ kind: 'service-restart', description: { en: 'Restart the database', zh: '重启数据库' } }],
                  before: { state: 'installed', version: '1' },
                  target: { version: '2' },
                },
              ],
              risks: { major: true },
            },
          ],
        )
        await pool.query(
          "update server_change_plans set state='awaiting_confirmation',revision=revision+1 where id=$1",
          [plan.id],
        )
        plan = await readChangePlan(db, plan.id)
        await assert.rejects(
          call('platform_server_upgrade_admin', 'apply', {
            plan_id: plan.id,
            revision: String(plan.revision),
            review_digest: 'stale',
            ...window,
          }),
          (error) => (error as { code: string }).code === 'plan_not_ready',
        )
        const count = approvals
        const ready = await call('platform_server_upgrade_admin', 'show', { plan_id: plan.id }) as ReturnType<typeof planResult>
        assert.equal(ready.next_step?.tool, 'platform_server_upgrade_admin')
        assert.ok(ready.next_step && 'required_input' in ready.next_step)
        assert.deepEqual(ready.next_step.required_input, ['start', 'end', 'timezone'])
        assert.equal(ready.next_step.arguments.action, 'apply')
        const scheduled = await call('platform_server_upgrade_admin', ready.next_step.arguments.action, { ...ready.next_step.arguments.input, ...window }) as ReturnType<typeof planResult>
        assert.equal(approvals - count, 1)
        assert.match(preview, /Replace/)
        assert.match(preview, /Asia\/Shanghai/)
        assert.equal((await readChangePlan(db, plan.id)).state, 'scheduled')
        assert.equal(scheduled.state, 'scheduled')
        assert.match(scheduled.guidance, /Do not re-apply or claim success/)
        const cancelled = await call('platform_server_upgrade_admin', 'cancel', { plan_id: plan.id }) as ReturnType<typeof planResult>
        assert.equal(cancelled.next_step, null)
        assert.equal((await readChangePlan(db, plan.id)).state, 'cancelled')
        // Simulate the worker's persisted terminal states without contacting a server.
        await pool.query("update server_change_plans set state='completed' where id=$1", [plan.id])
        await pool.query("update server_change_targets set state='succeeded' where plan_id=$1", [plan.id])
        const completed = await call('platform_server_upgrade_admin', 'show', { plan_id: plan.id }) as ReturnType<typeof planResult>
        assert.deepEqual(completed.next_step, { tool: 'platform_server_get', arguments: { server } })
        await pool.query("update server_change_plans set state='blocked' where id=$1", [plan.id])
        const blocked = await call('platform_server_upgrade_admin', 'show', { plan_id: plan.id }) as ReturnType<typeof planResult>
        assert.equal(blocked.next_step, null)
        assert.match(blocked.guidance, /preflight_error/)
        await call('platform_server_admin', 'delete', { server, expected_config_revision: '1' })
        const event = (
          await pool.query(
            "select * from server_audit_log where metadata->>'target_id'=$1 and metadata->>'action'='delete'",
            [server],
          )
        ).rows[0]
        assert.equal(event.server_id, null)
        assert.ok(event.server_name)
        assert.equal(event.metadata.target_type, 'server')
      },
    )
    await t.test(
      'key generation never exposes secrets and downloads require an authenticated, single-use human confirmation',
      async () => {
        const generated = (await call('platform_server_key_admin', 'create', {
          name: 'generated',
        })) as { id: string }
        assert.doesNotMatch(JSON.stringify(generated), /PRIVATE KEY|ciphertext/)
        const ticket = (await call('platform_server_key_admin', 'reveal', {
          key_id: generated.id,
        })) as { url: string }
        type Route = Parameters<HttpHost['webServer']['register']>[0]
        const routes: Route[] = [],
          errors: unknown[] = []
        const disposers = [
          ...registerRoutes(
            {
              consoleSession: {
                read: async (cookie) => (cookie === 'session=test' ? {} : undefined),
              },
              logger: { error: (cause) => errors.push(cause) },
              webServer: {
                register(route) {
                  routes.push(route)
                  return () => {}
                },
              },
            },
            deps,
          ),
        ]
        const http = createServer((req, res) => {
          const route = routes.find((r) => r.kind === 'prefix' && req.url?.startsWith(r.path))!
          void route.handler(req, res)
        })
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
        try {
          const address = http.address()
          assert.ok(address && typeof address === 'object')
          const url = `http://127.0.0.1:${address.port}${ticket.url}`,
            headers = { cookie: 'session=test' }
          assert.equal((await fetch(url)).status, 401)
          const english = await fetch(url, { headers: { ...headers, 'accept-language': 'en-US' } })
          assert.equal(english.headers.get('content-language'), 'en')
          assert.match(await english.text(), /Confirm and download private key/)
          deps.localePreference = () => 'zh'
          const chinese = await fetch(url, { headers: { ...headers, 'accept-language': 'en-US' } })
          assert.equal(chinese.headers.get('content-language'), 'zh')
          const page = await chinese.text()
          assert.match(page, /确认并下载私钥/)
          assert.doesNotMatch(page, /<pre>|"fingerprint"/)
          delete deps.localePreference
          assert.doesNotMatch(page, /PRIVATE KEY|ciphertext/)
          const token = page.match(/name="token" value="([a-f0-9]+)"/)![1]!
          const body = new URLSearchParams({ token })
          assert.equal(
            (
              await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'sec-fetch-site': 'cross-site' },
                body,
              })
            ).status,
            422,
          )
          const results = await Promise.all([
            fetch(url, { method: 'POST', headers, body }),
            fetch(url, { method: 'POST', headers, body }),
          ])
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 422])
          assert.match(await results.find((r) => r.status === 200)!.text(), /PRIVATE KEY/)
          const records = await pool.query(
            "select * from server_audit_log where metadata->>'target_id'=$1",
            [generated.id],
          )
          assert.doesNotMatch(JSON.stringify(records.rows), /PRIVATE KEY|secret_ciphertext/)
          assert.equal(records.rows.find((r) => r.metadata.action === 'reveal').actor_kind, 'web')
          assert.deepEqual(errors, [])
        } finally {
          await new Promise<void>((resolve) => http.close(() => resolve()))
          for (const dispose of disposers) dispose()
        }
      },
    )
    await t.test(
      'deployment and new-key verification failures retain the old reference and can resume',
      async () => {
        for (const failure of ['deploy', 'verify']) {
          const key = await makeKey(),
            server = await makeServer(key.id)
          const old = secrets.decrypt(
            (await pool.query('select secret_ciphertext from ssh_keys where id=$1', [key.id]))
              .rows[0].secret_ciphertext,
          )
          const authorized = new Set([publicKey(old)])
          let failing = true
          deps.connect = async (input) => {
            if (failing && failure === 'verify' && input.secret !== old)
              throw new Error('verification fixture')
            assert.ok(authorized.has(publicKey(input.secret)))
            return {
              fingerprint: 'SHA256:fixture',
              close() {},
              putScript: async () => {},
              shell: async () => {
                throw Error('unused')
              },
              async exec(_command, _timeout, options) {
                if (failing && failure === 'deploy')
                  return { code: 1, stdout: '', stderr: 'fixture' }
                const edit = JSON.parse(options!.stdin!)
                if (edit.mode === 'add') authorized.add(edit.new)
                else authorized.delete(edit.old)
                return { code: 0, stdout: 'ok', stderr: '' }
              },
            }
          }
          const result = (await call('platform_server_key_admin', 'rotate', {
            server,
            key_id: key.id,
            expected_config_revision: '1',
          })) as { state: string; operation_id: string }
          assert.equal(result.state, 'unknown')
          assert.equal(
            (await pool.query('select ssh_key_id from servers where id=$1', [server])).rows[0]
              .ssh_key_id,
            key.id,
          )
          assert.ok(authorized.has(publicKey(old)))
          const snapshot = await serverSnapshot(db, server)
          assert.equal((snapshot.rotations as { id: string }[])[0]!.id, result.operation_id)
          failing = false
          const resumed = (await call('platform_server_key_admin', 'rotate', {
            server,
            key_id: key.id,
            expected_config_revision: '1',
            operation_id: result.operation_id,
          })) as { state: string }
          assert.equal(resumed.state, 'completed')
          await deleteServer(db, server)
          await deleteKey(db, key.id)
        }
      },
    )
    await t.test(
      'interrupted key rotation persists phase, blocks edits and workers, and resumes without changing shared references',
      async () => {
        const key = await makeKey(),
          server = await makeServer(key.id),
          shared = await makeServer(key.id)
        const old = secrets.decrypt(
          (await pool.query('select secret_ciphertext from ssh_keys where id=$1', [key.id])).rows[0]
            .secret_ciphertext,
        )
        const authorized = new Set([publicKey(old)])
        let failRemove = true,
          closed = 0,
          opened = 0
        deps.connect = async (input) => {
          assert.equal(input.expectedFingerprint, 'SHA256:fixture')
          if (!authorized.has(publicKey(input.secret))) throw new Error('authentication failed')
          opened++
          return {
            fingerprint: 'SHA256:fixture',
            close() {
              closed++
            },
            putScript: async () => {},
            shell: async () => {
              throw Error('unused')
            },
            async exec(_command, _timeout, options) {
              const edit = JSON.parse(options!.stdin!)
              if (edit.mode === 'add') authorized.add(edit.new)
              else {
                if (failRemove) {
                  failRemove = false
                  return { code: 1, stdout: '', stderr: 'fixture' }
                }
                authorized.delete(edit.old)
              }
              return { code: 0, stdout: 'ok', stderr: '' }
            },
          }
        }
        const result = (await call('platform_server_key_admin', 'rotate', {
          server,
          key_id: key.id,
          expected_config_revision: '1',
        })) as { state: string; operation_id: string; new_key_id: string }
        assert.equal(result.state, 'unknown')
        assert.equal(opened, closed)
        assert.equal(
          (
            await pool.query('select phase from server_key_rotations where id=$1', [
              result.operation_id,
            ])
          ).rows[0].phase,
          'switched',
        )
        await assert.rejects(
          updateServer(deps, server, { ssh_port: 2223 }),
          (error) => (error as { code: string }).code === 'server_busy',
        )
        await assert.rejects(
          deleteServer(db, server),
          (error) => (error as { code: string }).code === 'server_busy',
        )
        assert.equal((await tryLockServer(db, server)).rows.length, 0)
        await pool.query('delete from server_jobs')
        for (const id of [server, shared])
          await pool.query(
            "insert into server_jobs(id,server_id,server_identity,purpose,expected_config_revision,expected_environment_revision,definition_revision,idempotency_key,operation_id,request_snapshot) values(gen_random_uuid(),$1,$1,'inspect',1,0,'',gen_random_uuid()::text,gen_random_uuid(),'{}')",
            [id],
          )
        assert.equal((await nextCandidate(db)).rows[0]!.server_id, shared)
        await assert.rejects(
          deleteKey(db, key.id),
          (error) => (error as { code: string }).code === 'key_in_use',
        )
        const resumed = (await call('platform_server_key_admin', 'rotate', {
          server,
          key_id: key.id,
          expected_config_revision: '2',
          operation_id: result.operation_id,
        })) as { state: string }
        assert.equal(resumed.state, 'completed')
        assert.equal(opened, closed)
        assert.equal(authorized.has(publicKey(old)), false)
        assert.equal(
          (await pool.query('select ssh_key_id from servers where id=$1', [shared])).rows[0]
            .ssh_key_id,
          key.id,
        )
        assert.equal(
          (await pool.query('select ssh_key_id from servers where id=$1', [server])).rows[0]
            .ssh_key_id,
          result.new_key_id,
        )
        await deleteServer(db, server)
        await deleteServer(db, shared)
        await deleteKey(db, key.id)
        assert.doesNotMatch(
          JSON.stringify(
            (
              await pool.query("select * from server_audit_log where metadata->>'target_id'=$1", [
                server,
              ])
            ).rows,
          ),
          /PRIVATE KEY|secret_ciphertext/,
        )
      },
    )
    await t.test(
      'audit export records the event; retention archives before deleting and retains rows on failure',
      async () => {
        const directory = await mkdtemp(join(tmpdir(), 'smp-audit-test-'))
        t.after(() => rm(directory, { recursive: true, force: true }))
        const exported = (await call('platform_audit_admin', 'export', { kind: 'admin' })) as {
          url: string
          count: number
        }
        assert.ok(exported.count > 0)
        const record = (
          await pool.query('select content from server_admin_downloads where id=$1', [
            exported.url.split('/').pop(),
          ])
        ).rows[0]
        assert.doesNotMatch(record.content, /PRIVATE KEY|secret_ciphertext/)
        const id = randomUUID()
        await pool.query(
          "insert into server_audit_log(id,kind,actor_id,actor_kind,tool_name,permission_mode,approval_status,status,created_at) values($1,'admin','owner','harness','fixture','admin','approved','succeeded',now()-interval '30 days')",
          [id],
        )
        const bad = join(directory, 'not-a-directory')
        await writeFile(bad, 'file')
        const set = (archive_directory: string, enabled = false) =>
          call('platform_audit_admin', 'retention', {
            mode: 'set',
            days: 7,
            archive_directory,
            next_run: new Date(Date.now() + 3600000).toISOString(),
            enabled,
          })
        await set(bad)
        await assert.rejects(call('platform_audit_admin', 'retention', { mode: 'run' }))
        assert.equal(
          (await pool.query('select id from server_audit_log where id=$1', [id])).rows.length,
          1,
        )
        await set(directory)
        const result = (await call('platform_audit_admin', 'retention', { mode: 'run' })) as {
          archive: string
          archived: number
        }
        assert.equal(result.archived, 1)
        assert.equal(JSON.parse(await readFile(result.archive, 'utf8'))[0].id, id)
        assert.equal(
          (await pool.query('select id from server_audit_log where id=$1', [id])).rows.length,
          0,
        )
        await set(directory, true)
        const policy = (await pool.query('select * from server_audit_retention')).rows[0]
        await pool.query("update server_audit_retention set next_run=now()-interval '1 second'")
        const before = approvals
        await scheduledRetention(db, new AbortController().signal)
        assert.equal(approvals, before)
        const scheduled = (
          await pool.query(
            "select * from server_audit_log where actor_kind='system' order by created_at desc limit 1",
          )
        ).rows[0]
        assert.equal(scheduled.approval_id, policy.approval_id)
        assert.equal(+scheduled.approved_at, +policy.updated_at)
        assert.ok(
          (
            await pool.query(
              "select id from server_audit_log where metadata->>'action'='retention'",
            )
          ).rows.length >= 4,
        )
      },
    )
  },
)
