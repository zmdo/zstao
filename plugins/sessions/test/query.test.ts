import assert from 'node:assert/strict'
import test from 'node:test'
import { jumpTarget, pageSlice, sessionIdError, sessionMatches, sessionOnDates, sessionStatusMatches, sessionVisible, sessionWorkspaceMatches, archiveWorkspaceLabel, workspaceName, workspaceOf } from '../src/query.ts'
import { removeArchivedSession, type SessionRemoval } from '../src/remove.ts'

test('title search ignores the session id', () => {
  const row = { id: 'session-abc', title: '周报' }
  assert.equal(sessionMatches(row, 'title', '周'), true)
  assert.equal(sessionMatches(row, 'title', 'abc'), false)
  assert.equal(sessionMatches(row, 'title', '  '), true)
})

test('id search ignores the title', () => {
  const row = { id: 'session-abc', title: '周报' }
  assert.equal(sessionMatches(row, 'id', 'ABC'), true)
  assert.equal(sessionMatches(row, 'id', '周报'), false)
})

test('status and date filters combine with the search', () => {
  const row = { id: 'session-abc', title: '周报', archived: true, updatedAt: Date.parse('2026-10-17T15:00:00') }
  assert.equal(sessionVisible(row, { by: 'title', query: '周', status: 'archived', from: '2026-10-17', to: '2026-10-17' }), true)
  assert.equal(sessionStatusMatches(false, 'archived'), false)
  assert.equal(sessionOnDates(row.updatedAt, '2026-10-18', ''), false)
  assert.equal(sessionOnDates(row.updatedAt, '', ''), true)
  assert.equal(sessionOnDates(0, '2026-10-17', ''), false)
})

test('workspace filter keeps only the selected directory', () => {
  assert.equal(sessionWorkspaceMatches('/work', ''), true)
  assert.equal(sessionWorkspaceMatches('/work', '/work'), true)
  assert.equal(sessionWorkspaceMatches('/other', '/work'), false)
})

test('a page keeps its own slice and a jump lands inside the list', () => {
  const rows = ['a', 'b', 'c']
  assert.deepEqual(pageSlice(rows, 2, 2), ['c'])
  assert.equal(jumpTarget('2', 3, 2), 2)
  assert.equal(jumpTarget('9', 3, 2), 2)
  assert.equal(jumpTarget('0', 3, 2), undefined)
})

test('a session is attributed to the workspace that lists it', () => {
  const accounts = [{ title: 'default-workspace', path: '/work', sessionIds: ['session-abc'] }]
  const owned = workspaceOf('session-abc', '/elsewhere', accounts)
  assert.equal(owned?.path, '/work')
  assert.equal(workspaceName('default-workspace', '默认工作区'), '默认工作区')
  assert.equal(workspaceOf('missing', '/work', accounts)?.title, 'default-workspace')
})

test('a session id with spaces is rejected', () => {
  assert.equal(sessionIdError('session-1'), undefined)
  assert.equal(sessionIdError(''), '会话编号不对')
  assert.equal(sessionIdError('session 1'), '会话编号不对')
})

test('delete refuses a session that is not archived', async () => {
  const result = await removeArchivedSession(removal(), 'session-1')
  assert.deepEqual(result, { ok: false, status: 400, detail: '先归档再删除' })
})

test('delete refuses a session that is still running', async () => {
  const result = await removeArchivedSession(removal({ archived: () => true, running: () => true }), 'session-1')
  assert.deepEqual(result, { ok: false, status: 409, detail: '会话还在跑' })
})

test('delete erases the log before clearing the archive flag', async () => {
  const order: string[] = []
  const result = await removeArchivedSession(removal({
    archived: () => true,
    erase: async () => { order.push('erase') },
    detach: async () => { order.push('detach') },
    unarchive: async () => { order.push('unarchive') },
  }), 'session-1')
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(order, ['erase', 'detach', 'unarchive'])
})

test('a live session is released before its log is erased', async () => {
  let live = true
  const order: string[] = []
  const result = await removeArchivedSession(removal({
    archived: () => true,
    live: () => live,
    release: async () => {
      order.push('release')
      live = false
      return true
    },
    erase: async () => { order.push('erase') },
  }), 'session-1')
  assert.equal(result.ok, true)
  assert.deepEqual(order.slice(0, 2), ['release', 'erase'])
})

function removal(overrides: Partial<SessionRemoval> = {}): SessionRemoval {
  return {
    archived: () => false,
    running: () => false,
    live: () => false,
    release: async () => false,
    detach: async () => undefined,
    unarchive: async () => undefined,
    erase: async () => undefined,
    ...overrides,
  }
}

test('archive labels preserve the resolved group language and translate only the default workspace title', () => {
  assert.equal(archiveWorkspaceLabel('默认组', 'default-workspace', '默认工作区'), '默认组/默认工作区')
  assert.equal(archiveWorkspaceLabel('Default Group', 'default-workspace', 'Default workspace'), 'Default Group/Default workspace')
  assert.equal(archiveWorkspaceLabel('临时工作区组', '运维', '默认工作区'), '临时工作区组/运维')
})
