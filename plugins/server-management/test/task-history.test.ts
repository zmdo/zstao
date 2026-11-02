import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import test from 'node:test'
import { Pool } from 'pg'
import { parseTaskQuery } from '../src/host/http/task-query.ts'
import { routeJobs } from '../src/host/http/jobs.ts'
import {claimNext,enqueue} from '../src/host/execution/queue.ts'
import {finishJob} from '../src/host/execution/completion.ts'
import {cancelJob} from '../src/host/tasks/cancel.ts'
import { HttpError } from '../src/host/errors.ts'

test('task queries validate limits, explicit time zones, filters and range ordering', () => {
  const server = randomUUID()
  const parse = (extra: Record<string, string>) => parseTaskQuery(new URLSearchParams({ server_id: server, ...extra }))
  assert.equal(parse({}).pageSize, 10)
  assert.equal(parse({ page: '2', page_size: '100', from: '2026-10-19T08:00:00+08:00' }).from, '2026-10-19T00:00:00.000Z')
  const invalid: Record<string, string>[] = [
    { server_id: '' }, { page: '0' }, { page: '1.5' }, { page_size: '101' }, { page: '1000001' },
    { status: 'bad' }, { action: "inspect' OR true" }, { q: 'x'.repeat(201) },
    { from: 'yesterday' }, { from: '2026-10-19T08:00' },
    { from: '2026-10-19T08:00Z', to: '2026-10-19T07:00Z' },
  ]
  for (const extra of invalid) assert.throws(() => parse(extra), { code: 'task_query_invalid' })
})

test('inspection reports and filtered task pages preserve errors without flooding history',
  { skip: !process.env.SMP_TEST_DATABASE_URL, timeout: 60_000 }, async t => {
    const schema = `task_history_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL })
    await admin.query(`create schema ${schema}`)
    const db = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL, options: `-c search_path=${schema}` })
    t.after(async () => { await db.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end() })
    for (const file of ['0010_server_management.sql', '0012_server_types.sql', '0013_server_observations.sql', '0014_server_execution.sql', '0016_server_version_policies.sql', '0027_server_audit_log.sql', '0033_server_admin.sql'])
      await db.query(await readFile(new URL(`../../database/migrations/${file}`, import.meta.url), 'utf8'))
    const server = randomUUID(), other = randomUUID()
    for (const id of [server, other]) {
      await db.query(`insert into servers(id,name,host,ssh_user,auth_method,secret_ciphertext,type_key,type_snapshot,type_revision,declared_os)
        values($1::uuid,'test',$1::uuid::text,'test','password','ciphertext','builtin/vacant','{}','test','{}')`, [id])
      await db.query('insert into server_runtime(server_id) values($1)', [id])
    }
    const hour = (await db.query("select date_trunc('hour',now() at time zone 'UTC') at time zone 'UTC'-interval '2 hours' as value")).rows[0].value as Date
    const stamp = (minutes: number) => new Date(hour.getTime() + minutes * 60_000).toISOString()
    async function seed(action: string, state: string, minutes: number, output = '', serverId = server, source: 'manual' | 'scheduled' = 'scheduled') {
      const id = randomUUID()
      const terminal = ['succeeded', 'failed', 'blocked', 'cancelled'].includes(state)
      await db.query(`insert into server_jobs(id,server_id,server_identity,purpose,state,phase,expected_config_revision,
        expected_environment_revision,definition_revision,idempotency_key,operation_id,request_snapshot,output_excerpt,created_at,finished_at)
        values($1,$2,$2,'inspect',$3,$4,1,0,'test',$1::uuid::text,$5,$6,$7,$8,$9)`,
        [id, serverId, state, terminal ? 'finished' : 'waiting', randomUUID(), JSON.stringify({ action, prepare: action === 'install_components', source }), output, stamp(minutes), terminal ? stamp(minutes) : null])
      return id
    }
    for (let n = 0; n < 30; n++) await seed('inspect', 'succeeded', n)
    const errorId = await seed('inspect', 'failed', 31, 'Needle%: permission denied')
    await seed('inspect', 'blocked', 32, 'blocked by configuration')
    // Current-hour successes stay out of history until the hour ends.
    await seed('inspect', 'succeeded', 121)
    const hiddenActive = await seed('inspect', 'queued', 122)
    await seed('inspect', 'failed', 33, 'other server only', other)
    for (let n = 0; n < 24; n++) await seed('install_components', 'succeeded', 40)
    const queued = await seed('test_connection', 'queued', 41)
    // Upgrade the populated schema; historical inspection counts are backfilled once.
    await db.query(await readFile(new URL('../../database/migrations/0015_server_inspection_reports.sql', import.meta.url), 'utf8'))
    assert.equal((await db.query('select count(*)::int as count from server_jobs')).rows[0].count, 60)
    const http = createServer(async (req, res) => {
      try { await routeJobs(db, req, res, new URL(req.url!, 'http://localhost').pathname.slice(5)) }
      catch (cause) {
        res.writeHead(cause instanceof HttpError ? cause.status : 500, { 'content-type': 'application/json' })
        res.end(JSON.stringify(cause instanceof HttpError ? { code: cause.code } : { message: String(cause) }))
      }
    })
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>(resolve => http.close(() => resolve())))
    const address = http.address()
    assert.ok(address && typeof address !== 'string')
    const root = `http://127.0.0.1:${address.port}/jobs`
    async function page(extra: Record<string, string> = {}) {
      const response = await fetch(`${root}?${new URLSearchParams({ server_id: server, ...extra })}`)
      const body = await response.json() as any
      assert.equal(response.status, 200, JSON.stringify(body))
      return body
    }
    const first = await page()
    assert.equal(first.total, 28) // 24 installation checks, 1 manual test, 2 errors, 1 report.
    assert.equal(first.items.length, 10)
    const second = await page({ page: '2' }), last = await page({ page: '999' })
    assert.equal(second.page, 2)
    assert.equal(last.page, 3)
    assert.equal(last.items.length, 8)
    const all = [...first.items, ...second.items, ...last.items]
    assert.equal(new Set(all.map(item => item.id)).size, 28)
    assert.equal(all.some(item => item.id === hiddenActive), false)
    assert.deepEqual((await page({ page: '2' })).items.map((item: any) => item.id), second.items.map((item: any) => item.id))
    const reports = await page({ action: 'inspection_report' })
    assert.equal(reports.total, 1)
    assert.equal(reports.items[0].result.succeeded, 30)
    assert.equal(reports.items[0].result.failed, 2)
    assert.equal(reports.items[0].status, 'failed')
    const errors = await page({ action: 'inspect', status: 'failed' })
    assert.deepEqual(errors.items.map((item: any) => item.id), [errorId])
    assert.equal((await page({ q: 'Needle%' })).total, 1)
    assert.equal((await page({ q: '%' })).total, 1) // Literal text, not a SQL wildcard.
    assert.equal((await page({ q: 'other server' })).total, 0)
    assert.equal((await page({ q: "' OR true--" })).total, 0)
    assert.equal((await page({ from: stamp(40), to: stamp(41) })).total, 24)
    assert.equal((await page({ from: stamp(41), to: stamp(42) })).items[0].id, queued)
    const empty = await page({ q: 'missing output', page: '999' })
    assert.equal(empty.page, 1)
    assert.deepEqual(empty.items, [])
    // Hidden records remain directly readable for action receipts and execution auditing.
    assert.equal((await fetch(`${root}/${hiddenActive}`)).status, 200)
    // Remove only these queued fixtures before exercising the real fenced completion path.
    await db.query('delete from server_jobs where id=any($1::uuid[])', [[hiddenActive, queued]])
    const pending = await enqueue(db, server, 'inspect')
    const job = await claimNext(db, 'report-worker')
    assert.equal(job?.id, pending.id)
    await finishJob(db, job!, 'succeeded', 'read only', { summary: 'inspected' })
    const current = (await db.query('select * from server_inspection_reports where server_identity=$1 order by hour_start desc', [server])).rows[0]
    assert.equal(current.succeeded, 2)
    await assert.rejects(finishJob(db, job!, 'succeeded', 'duplicate'), { code: 'job_lease_lost' })
    assert.equal((await db.query('select succeeded from server_inspection_reports where server_identity=$1 and hour_start=$2', [server, current.hour_start])).rows[0].succeeded, 2)
    const failed = await enqueue(db, server, 'inspect')
    const next = await claimNext(db, 'report-worker')
    assert.equal(next?.id, failed.id)
    await finishJob(db, next!, 'failed', 'failed connection')
    assert.equal((await page({ action: 'inspect', status: 'failed' })).total, 2)
    const manualId = await seed('inspect', 'succeeded', 34, 'manual inspect', server, 'manual')
    const manualPage = await page({ action: 'inspect', status: 'succeeded' })
    assert.ok(manualPage.items.some((item: any) => item.id === manualId))
    assert.equal(manualPage.total, 1)
    assert.equal((await page({ action: 'inspection_report' })).total, 1)
    const cancelled = await enqueue(db, server, 'inspect')
    await cancelJob(db, cancelled.id)
    assert.equal((await db.query('select state from server_jobs where id=$1', [cancelled.id])).rows[0].state, 'cancelled')
    await assert.rejects(cancelJob(db, cancelled.id), { code: 'job_not_cancellable' })
    const routeCancelled = await enqueue(db, server, 'inspect')
    const response = await fetch(`${root}/${routeCancelled.id}/cancel`, { method: 'POST' })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { status: string }).status, 'cancelled')
    const repeated = await fetch(`${root}/${routeCancelled.id}/cancel`, { method: 'POST' })
    assert.equal(repeated.status, 409)
  })
