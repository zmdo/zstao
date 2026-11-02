import assert from 'node:assert/strict'
import test from 'node:test'
import { sidebarProjection } from '../src/sidebar-projection.ts'
import type { GroupSnapshot, SessionSnapshot, WorkspaceSnapshot } from '../src/contract.ts'

const groups: GroupSnapshot = {
  groups: [], focus: [], allows: [],
  members: [
    { workspaceId: 'a', groupId: 'general', directory: '/a', isDefault: true, lastSessionId: null },
    { workspaceId: 'b', groupId: 'sample', directory: '/b', isDefault: true, lastSessionId: null },
  ],
}
const workspaces: WorkspaceSnapshot = {
  phase: 'ready', state: 'connected', archivedSessionIds: ['b1'], pinnedSessionIds: ['a1'],
  items: [
    { workspaceId: 'a', path: '/a', title: 'Same title', sessionIds: ['a1'] },
    { workspaceId: 'b', path: '/b', title: 'Same title', sessionIds: ['b1'] },
    { workspaceId: 'pending', path: '/pending', title: 'Pending membership', sessionIds: ['pending1'] },
  ],
}
const sessions: SessionSnapshot = {
  phase: 'ready', ids: ['a1', 'b1', 'orphan', 'pending1'],
  byId: { a1: { id: 'a1' }, b1: { id: 'b1' }, orphan: { id: 'orphan', cwd: '/a' }, pending1: { id: 'pending1' } },
}

test('native sidebar receives only its group without changing either global source', () => {
  const projected = sidebarProjection('general', groups, workspaces, sessions)
  assert.deepEqual(projected.workspaces.items.map(w => w.workspaceId), ['a'])
  assert.deepEqual(projected.sessions.ids, ['a1'])
  assert.deepEqual(Object.keys(projected.sessions.byId), ['a1'])
  assert.equal(projected.workspaces.archivedSessionIds, workspaces.archivedSessionIds)
  assert.equal(projected.workspaces.pinnedSessionIds, workspaces.pinnedSessionIds)
  assert.equal(workspaces.items.length, 3)
  assert.equal(sessions.ids.length, 4)
})

test('unassigned receives orphans, never sessions owned by a filtered or pending workspace', () => {
  const projected = sidebarProjection('unassigned', groups, workspaces, sessions)
  assert.deepEqual(projected.workspaces.items, [])
  assert.deepEqual(projected.sessions.ids, ['orphan'])
  assert.deepEqual(Object.keys(projected.sessions.byId), ['orphan'])
})

test('same titles remain separate native rows in different groups', () => {
  const first = sidebarProjection('general', groups, workspaces, sessions)
  const second = sidebarProjection('sample', groups, workspaces, sessions)
  assert.equal(first.workspaces.items[0].title, second.workspaces.items[0].title)
  assert.deepEqual(second.sessions.ids, ['b1'])
})
