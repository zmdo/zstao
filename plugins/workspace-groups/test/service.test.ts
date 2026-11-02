import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Pool } from 'pg'
import { parse } from 'yaml'
import { GroupRegistry, type Registry, type WorkspaceRecord } from '../src/service.ts'
import { GroupFailure } from '../src/contract.ts'
import { normalizeDatabaseUrl } from '../../database/src/url.ts'

class FakeRegistry implements Registry {
  records = new Map<string, WorkspaceRecord>()
  archivedSessionIds: string[] = []
  failNext = false
  list() { return [...this.records.values()] }
  get(id: string) { return this.records.get(id) }
  async create(path: string, title = path.split('/').at(-1)!) {
    if (this.failNext) { this.failNext = false; throw new Error('simulated durable write failure') }
    const existing = this.list().find(w => w.path === path)
    if (existing) return existing
    const item: WorkspaceRecord = { id: randomUUID(), path, title, sessionIds: [], async setTitle(value) { this.title = value }, async attachSession(id) { this.sessionIds = [...this.sessionIds, id] } }
    this.records.set(item.id, item)
    return item
  }
  async delete(id: string) { return this.records.delete(id) }
}

test('workspace group persistence, conflicts, focus, removal, and recovery', async t => {
  const profile = process.env.SMP_TEST_PROFILE
  if (!profile) { t.skip('SMP_TEST_PROFILE is not set'); return }
  const patch = parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))
  const config = patch.find((row: { id: string }) => row.id === 'smp-database').config
  const admin = new Pool({ connectionString: normalizeDatabaseUrl(config.databaseUrl) })
  const schema = `smp_groups_test_${randomUUID().replaceAll('-', '')}`
  await admin.query(`create schema ${schema}`)
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(config.databaseUrl), options: `-c search_path=${schema}` })
  const home = await realpath(await mkdtemp(join(tmpdir(), 'smp-workspace-groups-')))
  const registry = new FakeRegistry()
  const groups = new GroupRegistry(pool, registry, home)
  t.after(async () => { await groups.close(); await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); await rm(home, { recursive: true }) })
  await pool.query(await readFile(new URL('../../database/migrations/0006_session_log.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../../database/migrations/0010_workspace_groups.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../../database/migrations/0011_workspace_group_navigation.sql', import.meta.url), 'utf8'))
  await groups.register({ id: 'general', label: '普通', directory: 'general' })
  await groups.register({ id: 'sample', label: '临时', labelI18n: { zh: '临时工作区组', en: 'Sample workspace group' }, directory: 'sample' })
  await t.test('registered plugin translations are transported with the snapshot without changing membership', async () => {
    const snapshot = await groups.view()
    assert.deepEqual(snapshot.groups.find(group => group.id === 'sample')?.labelI18n, { zh: '临时工作区组', en: 'Sample workspace group' })
    assert.deepEqual(snapshot.groups.find(group => group.id === 'unassigned')?.labelI18n, { zh: '未归属', en: 'Unassigned' })
    assert.equal(snapshot.members.filter(member => member.groupId === 'sample').length, 1)
  })
  const pathA = join(home, 'project-a'); const pathB = join(home, 'project-b'); const pathC = join(home, 'project-c')
  await Promise.all([mkdir(pathA), mkdir(pathB), mkdir(pathC)])
  let firstId = ''
  await t.test('same-group reuse and cross-group realpath conflicts expose navigation target', async () => {
    const first = await groups.add('general', pathA, 'Project')
    firstId = first.workspaceId
    assert.equal((await groups.add('general', pathA)).workspaceId, firstId)
    const alias = join(home, 'alias'); await symlink(pathA, alias)
    const before = registry.list().length
    await assert.rejects(() => groups.add('sample', alias), (error: unknown) => error instanceof GroupFailure && error.code === 'workspace-group/directory-conflict' && error.owner?.workspaceId === firstId && error.owner.groupId === 'general')
    assert.equal(registry.list().length, before)
  })
  await t.test('cross-group duplicate titles work, in-group duplicates are rejected', async () => {
    const second = await groups.add('sample', pathB, 'Other')
    await groups.rename(second.workspaceId, 'Project')
    assert.equal(registry.get(second.workspaceId)?.title, 'Project')
    await assert.rejects(() => groups.add('general', pathC, 'Project'), (error: unknown) => error instanceof GroupFailure && error.code === 'workspace-group/name-conflict')
    const third = await groups.add('general', pathC, 'Third')
    await assert.rejects(() => groups.rename(third.workspaceId, 'Project'), /已存在/)
    assert.equal(registry.get(third.workspaceId)?.title, 'Third')
  })
  await t.test('system group rejects additions and creates no default workspace', async () => {
    await assert.rejects(() => groups.add('unassigned', pathC), /不能添加/)
    const snapshot = await groups.view()
    assert.equal(snapshot.members.some(m => m.groupId === 'unassigned'), false)
    assert.equal(snapshot.groups.filter(g => g.kind === 'system').length, 1)
  })
  await t.test('focus tracks different sessions in the same workspace and rejects archived/foreign sessions', async () => {
    for (const id of ['s1', 's2']) await pool.query('insert into console_session values ($1, $2, 0, 0, 0)', [id, JSON.stringify({ id, cwd: pathA })])
    await registry.get(firstId)!.attachSession('s1'); await registry.get(firstId)!.attachSession('s2')
    await groups.focus('general', firstId, 's1'); await groups.focus('general', firstId, 's2')
    assert.equal((await groups.view()).focus.find(f => f.groupId === 'general')?.sessionId, 's2')
    assert.equal((await groups.view()).members.find(m => m.workspaceId === firstId)?.lastSessionId, 's2')
    await assert.rejects(() => groups.focus('sample', firstId, 's1'), /不属于/)
    registry.archivedSessionIds.push('s2')
    await assert.rejects(() => groups.focus('general', firstId, 's2'), /已归档/)
    registry.archivedSessionIds = []
  })
  await t.test('removal makes sessions unassigned and same-group re-registration restores real membership', async () => {
    await groups.remove(firstId)
    assert.equal(await groups.groupForSession('s1'), 'unassigned')
    await groups.focus('unassigned', null, 's1')
    await assert.rejects(() => groups.add('sample', pathA), /已属于/)
    const restored = await groups.add('general', pathA, 'Project')
    assert.notEqual(restored.workspaceId, firstId)
    assert.equal(await groups.groupForSession('s1'), 'general')
  })
  await t.test('failed writes release new pending ownership and leave the queue usable', async () => {
    const path = join(home, 'failure'); await mkdir(path)
    registry.failNext = true
    await assert.rejects(() => groups.add('sample', path), /simulated/)
    assert.equal((await pool.query('select * from workspace_group_directories where directory = $1', [path])).rowCount, 0)
    const result = await groups.add('general', path)
    assert.ok(result.workspaceId)
  })
  await t.test('concurrent requests for one directory have exactly one group owner', async () => {
    const path = join(home, 'race'); await mkdir(path)
    const results = await Promise.allSettled([groups.add('general', path), groups.add('sample', path)])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal((await pool.query('select * from workspace_group_directories where directory = $1', [path])).rowCount, 1)
  })
})
