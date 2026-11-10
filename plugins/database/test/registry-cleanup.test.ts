import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pool } from 'pg'
import { applyMigrations } from '../src/migrate.ts'

const url = process.env.SMP_TEST_DATABASE_URL
const migration = '0048_cleanup_legacy_registry_credentials.sql'
const historical = '0047_registry_pull_credentials.sql'
const operation = '@smp/console-application-server/registry-credentials'

test('legacy TCR upgrade removes only retired data and refuses in-flight or unknown work', { skip: !url }, async t => {
  const admin = new Pool({ connectionString: url })
  const schema = `registry_cleanup_${randomUUID().replaceAll('-', '')}`
  await admin.query(`create schema ${schema}`)
  const db = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 1 })
  const directory = await mkdtemp(join(tmpdir(), 'ces-registry-cleanup-'))
  t.after(async () => {
    await db.end()
    await admin.query(`drop schema ${schema} cascade`)
    await admin.end()
    await rm(directory, { recursive: true, force: true })
  })
  for (const name of ['0010_server_management.sql', '0012_server_types.sql', '0013_server_observations.sql', '0014_server_execution.sql'])
    await db.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  const cleanup = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8')
  await writeFile(join(directory, migration), cleanup)
  // Fresh baseline is supported, and rerunning the SQL itself is harmless.
  assert.deepEqual(await applyMigrations(db, directory), [migration])
  assert.deepEqual(await applyMigrations(db, directory), [])
  await db.query('begin'); await db.query(cleanup); await db.query('commit')

  // Reconstruct precisely the deployed 0047 schema, preserving its migration ledger.
  await db.query('delete from console_schema_migrations where id=$1', [migration])
  await db.query(await readFile(new URL(`fixtures/${historical}`, import.meta.url), 'utf8'))
  await db.query('insert into console_schema_migrations(id) values($1)', [historical])
  const server = randomUUID(), key = randomUUID(), group = randomUUID(), normal = randomUUID(), legacy = randomUUID(), client = randomUUID()
  await db.query("insert into server_groups(id,name) values($1,'preserve')", [group])
  await db.query("insert into ssh_keys(id,name,fingerprint,secret_ciphertext) values($1,'preserve','fingerprint','ciphertext')", [key])
  await db.query(`insert into servers(id,name,host,ssh_user,auth_method,ssh_key_id,group_id,type_key,type_snapshot,type_revision,declared_os)
    values($1,'preserve','example.invalid','root','private_key',$2,$3,'builtin/vacant','{}','fixture','{}')`, [server, key, group])
  await db.query("create table unrelated_sentinel(value text); insert into unrelated_sentinel values('preserve')")
  for (const [id, purpose, request] of [[normal, 'inspect', {}], [legacy, 'configure', { operation }]])
    await db.query(`insert into server_jobs(id,server_id,server_identity,purpose,expected_config_revision,expected_environment_revision,definition_revision,idempotency_key,operation_id,request_snapshot)
      values($1::uuid,$2,$2,$3,1,0,'fixture',$1::text,$4,$5)`, [id, server, purpose, randomUUID(), JSON.stringify(request)])
  await db.query("insert into server_job_steps(id,job_id,ordinal,phase,state) values($1,$2,1,'preflight','running')", [randomUUID(), legacy])
  await db.query(`insert into application_registry_bindings(server_identity,server_id,credential_id,registry,desired_revision,job_id) values($1,$1,'old','registry.invalid',1,$2)`, [server, legacy])
  await db.query("insert into application_registry_clients(id,name,token_hash,server_ids,repositories) values($1,'old','hash','[]','[]')", [client])
  await db.query("insert into application_registry_requests(client_id,request_id,server_identity,image,job_id,deployment_job_id) values($1,'request',$2,'registry.invalid/image',$3,$3)", [client, server, legacy])
  for (const state of ['claimed', 'running', 'recovering']) {
    await db.query("update server_jobs set state=$2,worker_id='old-worker',fence=1,lease_expires_at=now()-interval '1 day' where id=$1", [legacy, state])
    await assert.rejects(applyMigrations(db, directory), /active configure jobs/)
    assert.equal((await db.query('select count(*)::int n from application_registry_bindings')).rows[0].n, 1)
    assert.equal((await db.query('select count(*)::int n from console_schema_migrations where id=$1', [migration])).rows[0].n, 0)
  }
  await db.query("update server_jobs set state='queued',request_snapshot='{}' where id=$1", [legacy])
  await assert.rejects(applyMigrations(db, directory), /unknown configure operation/)
  await db.query('update server_jobs set request_snapshot=$2 where id=$1', [legacy, JSON.stringify({ operation })])
  // An unexpected database dependency must roll back the earlier DELETE too.
  await db.query('create view preserve_dependency as select * from application_registry_bindings')
  await assert.rejects(applyMigrations(db, directory), /depend on it/)
  assert.equal((await db.query('select count(*)::int n from server_jobs where id=$1', [legacy])).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int n from application_registry_requests')).rows[0].n, 1)
  await db.query('drop view preserve_dependency')
  assert.deepEqual(await applyMigrations(db, directory), [migration])
  assert.deepEqual((await db.query('select id from server_jobs')).rows.map(r => r.id), [normal])
  assert.equal((await db.query('select count(*)::int n from server_job_steps')).rows[0].n, 0)
  for (const name of ['application_registry_requests', 'application_registry_bindings', 'application_registry_clients', 'server_configuration_sequence'])
    assert.equal((await db.query('select to_regclass($1) object', [name])).rows[0].object, null)
  assert.equal((await db.query('select ssh_key_id,group_id from servers where id=$1', [server])).rows[0].ssh_key_id, key)
  assert.equal((await db.query('select secret_ciphertext from ssh_keys')).rows[0].secret_ciphertext, 'ciphertext')
  assert.equal((await db.query('select value from unrelated_sentinel')).rows[0].value, 'preserve')
  assert.deepEqual((await db.query('select id from console_schema_migrations order by id')).rows.map(r => r.id), [historical, migration])
  await assert.rejects(db.query("update server_jobs set purpose='configure' where id=$1", [normal]), /server_jobs_purpose_check/)
  assert.deepEqual(await applyMigrations(db, directory), [])
})
