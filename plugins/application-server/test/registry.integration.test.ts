import { ciClient, managedDeploy } from '../../../scripts/deploy-managed-image.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Pool } from 'pg'
import { ConfigurationRegistry } from '../../server-management/src/host/configurations/registry.ts'
import { DefinitionRegistry } from '../../server-management/src/host/definitions/registry.ts'
import { claimNext, enqueue } from '../../server-management/src/host/execution/queue.ts'
import { executeJob } from '../../server-management/src/host/execution/worker.ts'
import { finishJob } from '../../server-management/src/host/execution/completion.ts'
import { registryHandler, API } from '../src/http.ts'
import { RegistryManager, OPERATION, TYPE } from '../src/registry.ts'
import type { PullCredential } from '../../project-repositories/src/contracts.ts'

// Always use an isolated schema; SMP_TEST_DATABASE_URL should point at a disposable database.
test('real PostgreSQL: scoped preparation, queue leases, recovery, rotation, offline retry and cleanup', { skip: !process.env.SMP_TEST_DATABASE_URL, timeout: 60_000 }, async t => {
  const schema = 'registry_' + randomUUID().replaceAll('-', '')
  const admin = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL })
  await admin.query(`create schema ${schema}`)
  const db = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL, options: `-c search_path=${schema}` })
  t.after(async () => { await db.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end() })
  for (const file of ['0010_server_management.sql','0012_server_types.sql','0013_server_observations.sql','0014_server_execution.sql','0016_server_version_policies.sql','0022_server_job_recovery_attempts.sql','0023_server_internal_host.sql','0026_server_auto_retry.sql','0027_server_audit_log.sql','0033_server_admin.sql','0047_registry_pull_credentials.sql']) {
    await db.query(await readFile(new URL(`../../database/migrations/${file}`, import.meta.url), 'utf8'))
  }
  const serverId = randomUUID(), otherId = randomUUID()
  for (const id of [serverId, otherId]) {
    await db.query(`insert into servers(id,name,host,ssh_user,auth_method,secret_ciphertext,type_key,type_snapshot,type_revision,declared_os,internal_host)
      values($1,'test',$1::uuid::text,'test','password','ssh-cipher',$2,'{}','test','{}','10.0.0.1')`, [id, TYPE])
    await db.query('insert into server_runtime(server_id) values($1)', [id])
  }
  const definitions = new DefinitionRegistry(db, [])
  const configurations = new ConfigurationRegistry(db)
  t.after(() => configurations.close())
  let credential: PullCredential = { id: 'platform-pull', revision: 1, registry: 'registry.example', repositories: ['team/*'], username: 'pull-only', configured: true, enabled: true, updatedAt: null }
  let resolved = 0
  const secret = 'DO-NOT-LOG-registry-password'
  const manager = new RegistryManager(db, { read: async () => ({ ...credential }), resolve: async (_id, revision) => { assert.equal(revision, credential.revision); resolved++; return { ...credential, password: secret } } }, {
    registerConfigurationOperation: op => configurations.register(op), enqueueConfiguration: input => configurations.enqueue(input), configurationTask: id => configurations.task(id),
  })
  const operationErrors: unknown[] = []
  const registration = configurations.register({ owner: '@smp/console-application-server', key: 'registry-credentials', validate: value => manager.validate(value), execute: async ctx => { try { return await manager.execute(ctx) } catch (cause) { operationErrors.push(cause); throw cause } } })
  const image = 'registry.example/team/app@sha256:' + 'a'.repeat(64)
  let remoteRevision = 0, generation = '', offline = false, throwSecret = false, loseDeploymentReply = false
  let deployments = 0
  const connect = async () => {
    if (offline) throw new Error('offline')
    return { fingerprint: 'SHA256:test', close() {}, async exec(command: string, _timeout: number, options?: { stdin?: string }) {
      assert.equal(command.includes(secret), false)
      if (throwSecret) throw new Error(secret)
      const input = JSON.parse(options!.stdin!)
      if (input.action === 'deploy' || input.action === 'deployment-status') {
        if (input.action === 'deploy') deployments++
        if (loseDeploymentReply && input.action === 'deploy') throw new Error('lost reply')
        return { code: 0, stdout: JSON.stringify({ pulled: true, deployed: true, image: input.image }), stderr: '' }
      }
      if (input.action === 'remove') { remoteRevision = 0; return { code: 0, stdout: JSON.stringify({ removed: true }), stderr: '' } }
      if (remoteRevision !== input.revision && !input.password) return { code: 0, stdout: JSON.stringify({ needsCredentials: true }), stderr: '' }
      if (input.password) { assert.equal(input.password, secret); remoteRevision = input.revision; generation = input.operationId }
      return { code: 0, stdout: JSON.stringify({ receipt: { serverId: input.serverId, credentialId: input.credentialId, revision: input.revision, configRevision: input.configRevision, generation }, reused: !input.password }), stderr: '' }
    } }
  }
  const work = async () => {
    const job = await claimNext(db, randomUUID(), configurations.keys())
    assert.ok(job)
    assert.equal(job.purpose, 'configure')
    await executeJob(db, { decrypt: () => 'ssh-secret' }, definitions, job, connect as never, 3600, undefined, configurations)
    return configurations.task(job.id)
  }
  const handler = registryHandler({ consoleSession: { read: async cookie => cookie === 'session=yes' ? {} : undefined } }, db, manager)
  const http = createServer(handler)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => http.close(() => resolve())))
  const address = http.address(); assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const post = (value: unknown, token?: string): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : { cookie: 'session=yes' }) }, body: JSON.stringify(value) })
  const fetchApi = (path: string, init?: RequestInit) => fetch(origin + API + path, init)
  const clientResponse = await fetchApi('/clients', post({ name: 'OneDev', serverIds: [serverId], repositories: ['registry.example/team/*'] }))
  assert.equal(clientResponse.status, 201)
  const { token } = await clientResponse.json()
  assert.equal((await db.query('select token_hash from application_registry_clients')).rows[0].token_hash.includes(token), false)
  assert.equal((await fetchApi('/prepare', post({}))).status, 401, 'browser cookie cannot call machine endpoint')
  assert.equal((await fetchApi('/prepare', post({ serverId: otherId, image, credentialId: 'platform-pull', requestId: 'other' }, token))).status, 403)
  assert.equal((await fetchApi('/prepare', post({ serverId, image: image.replace('/team/', '/other/'), credentialId: 'platform-pull', requestId: 'scope' }, token))).status, 403)
  const prepare = async (requestId: string) => {
    const response = await fetchApi('/prepare', post({ serverId, image, credentialId: 'platform-pull', requestId }, token))
    assert.equal(response.status, 202, await response.clone().text()); return response.json()
  }
  const status = async (id: string) => (await fetchApi('/requests/' + id, { headers: { authorization: `Bearer ${token}` } })).json()
  const first = await prepare('first')
  assert.equal((await prepare('first')).taskId, first.taskId)
  assert.equal(await claimNext(db, 'missing-provider'), undefined, 'no job claimed while provider unavailable')
  assert.equal((await work())!.state, 'succeeded', String(operationErrors)); assert.equal(resolved, 1)
  assert.equal((await status('first')).result.receipt.revision, 1)
  await prepare('second'); await work(); assert.equal(resolved, 1, 'same version does not resolve or resend password')
  const deployResponse = await fetchApi('/requests/second/deploy', post({}, token))
  assert.equal(deployResponse.status, 202)
  const deployed = await deployResponse.json()
  assert.equal((await work())!.state, 'succeeded'); assert.equal(deployments, 1)
  assert.equal((await (await fetchApi('/requests/second/deploy', post({}, token))).json()).id, deployed.id)
  assert.equal((await db.query('select pull_result from application_registry_requests where request_id=$1', ['second'])).rows[0].pull_result.pulled, true)
  // The common server queue serializes configuration with ordinary inspection.
  const pending = await prepare('serialized')
  const job = await claimNext(db, 'worker-1', configurations.keys()); assert.ok(job)
  const inspection = await enqueue(db, serverId, 'test_connection')
  assert.equal(await claimNext(db, 'worker-2', configurations.keys()), undefined)
  await db.query("update server_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [job.id])
  const recovered = await claimNext(db, 'worker-2', configurations.keys()); assert.ok(recovered)
  assert.equal(recovered.operation_id, job.operation_id); assert.ok(Number(recovered.fence) > Number(job.fence))
  await assert.rejects(finishJob(db, job, 'succeeded', ''), { code: 'job_lease_lost' })
  await executeJob(db, { decrypt: () => 'ssh-secret' }, definitions, recovered, connect as never, 3600, undefined, configurations)
  assert.equal((await configurations.task(pending.taskId))!.state, 'succeeded')
  await db.query("update server_jobs set state='cancelled',finished_at=now() where id=$1", [inspection.id])
  credential = { ...credential, revision: 2 }
  await manager.reconcile()
  credential = { ...credential, revision: 3 }
  await work(); assert.equal(remoteRevision, 3, 'queued v2 resolves latest v3 at execution')
  assert.equal((await manager.bindings())[0]!.state, 'synced')
  assert.equal((await status('first')).result.error, 'credential_receipt_stale')
  credential = { ...credential, revision: 4 }; offline = true
  await manager.reconcile(); assert.equal((await work())!.state, 'failed')
  await manager.reconcile(); assert.equal((await manager.bindings())[0]!.state, 'failed')
  offline = false
  await db.query("update application_registry_bindings set retry_at=now()-interval '1 second'")
  await manager.reconcile(); await work(); assert.equal(remoteRevision, 4)
  await prepare('lost-deployment-reply'); await work()
  await fetchApi('/requests/lost-deployment-reply/deploy', post({}, token))
  loseDeploymentReply = true
  const recovering = await work(); assert.equal(recovering!.state, 'recovering')
  assert.equal(deployments, 2)
  await db.query("update server_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [recovering!.id])
  assert.equal((await work())!.state, 'succeeded')
  assert.equal(deployments, 2, 'recovery queries the remote journal instead of replaying deployment')
  loseDeploymentReply = false
  const ci = ciClient({ baseUrl: origin, token, serverId, image, delay: async () => {},
    fetcher: async (url: URL, init: RequestInit) => {
      const response = await fetch(url, init)
      if (init.method === 'POST' && response.ok) await work()
      return response
    } })
  assert.equal((await managedDeploy(ci)).deployed, true, 'CI → authenticated HTTP → queue → managed execution completes')
  throwSecret = true
  await prepare('secret-error'); const failure = await work(); assert.equal(failure!.state, 'failed')
  const serialized = JSON.stringify((await db.query('select request_snapshot,result,output_excerpt from server_jobs')).rows)
  assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes('ssh-secret'), false)
  throwSecret = false
  await manager.setActive(serverId, false)
  await db.query("update application_registry_bindings set retry_at=now()-interval '1 second'")
  await manager.reconcile(); await work()
  assert.equal((await manager.bindings())[0]!.state, 'removed'); assert.equal(remoteRevision, 0)
  await assert.rejects(manager.prepare(serverId, image, 'platform-pull', 'revoked'), { code: 'binding_removed' })
  // A registry change never silently reuses bindings for the old endpoint.
  await manager.setActive(serverId, true)
  credential = { ...credential, registry: 'replacement.example', revision: 5 }
  await manager.reconcile()
  assert.equal((await manager.bindings())[0]!.active, false)
  await work()
  assert.equal((await manager.bindings())[0]!.state, 'removed')
  // Deleting a server while cleanup is pending retains an honest orphaned record.
  await db.query("update application_registry_bindings set state='cleanup_pending' where server_identity=$1", [serverId])
  await db.query('delete from servers where id=$1', [serverId])
  await manager.reconcile()
  assert.equal((await manager.bindings())[0]!.state, 'orphaned')
  await registration.dispose()
})
