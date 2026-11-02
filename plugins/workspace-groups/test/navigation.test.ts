import assert from 'node:assert/strict'
import test from 'node:test'
import { restoration, NavigationEpoch } from '../src/navigation.ts'
import { groupForSession, UNASSIGNED_GROUP_ID, normalizeGroup } from '../src/rules.ts'
import { GroupStore } from '../src/store.ts'
import type { GroupSnapshot, ListSource, SessionSnapshot, WorkspaceSnapshot } from '../src/contract.ts'

const workspaces = [{ workspaceId: 'a', path: '/a', title: 'A', sessionIds: ['a1', 'a2', 'blank'] }, { workspaceId: 'b', path: '/b', title: 'B', sessionIds: ['b1'] }]
const members = [{ workspaceId: 'a', groupId: 'general', directory: '/a', isDefault: true, lastSessionId: 'a1' }, { workspaceId: 'b', groupId: 'sample', directory: '/b', isDefault: true, lastSessionId: null }]
const sessions = { a1: { id: 'a1', updatedAt: 10 }, a2: { id: 'a2', updatedAt: 20 }, blank: { id: 'blank', blank: true }, b1: { id: 'b1' }, orphan: { id: 'orphan', cwd: '/a', updatedAt: 30 } }
const focus = { groupId: 'general', workspaceId: 'a', sessionId: 'a2' }

test('restore the exact last conversation before workspace recency or blanks', () => {
  assert.deepEqual(restoration('general', workspaces, members, sessions, [], focus), { kind: 'session', sessionId: 'a2' })
  assert.deepEqual(restoration('general', workspaces, members, sessions, ['a2'], focus), { kind: 'session', sessionId: 'a1' })
})
test('missing remembered conversations fall back to recent nonblank, then the default workspace', () => {
  assert.deepEqual(restoration('general', workspaces, members, sessions, ['a1'], { ...focus, sessionId: 'gone' }), { kind: 'session', sessionId: 'a2' })
  assert.deepEqual(restoration('general', workspaces, members, sessions, ['a1', 'a2'], focus), { kind: 'workspace', workspaceId: 'a' })
})
test('an orphan with a matching cwd is still unassigned and never appears in the former group', () => {
  assert.equal(groupForSession('orphan', workspaces, members), UNASSIGNED_GROUP_ID)
  assert.deepEqual(restoration(UNASSIGNED_GROUP_ID, workspaces, members, sessions, []), { kind: 'session', sessionId: 'orphan' })
  assert.deepEqual(restoration(UNASSIGNED_GROUP_ID, workspaces, members, {}, []), { kind: 'empty' })
  assert.throws(() => normalizeGroup({ id: UNASSIGNED_GROUP_ID, label: 'bad', directory: 'bad' }), /系统保留/)
})
test('an archived or foreign-group saved session cannot be restored', () => {
  assert.deepEqual(restoration('general', workspaces, members, sessions, [], { ...focus, sessionId: 'b1' }), { kind: 'session', sessionId: 'a1' })
  assert.deepEqual(restoration(UNASSIGNED_GROUP_ID, workspaces, members, sessions, ['orphan']), { kind: 'empty' })
})
test('a specific workspace selection never falls back to a different workspace', () => {
  assert.deepEqual(restoration('sample', workspaces, members, sessions, ['b1'], undefined, 'b'), { kind: 'workspace', workspaceId: 'b' })
})
test('superseded navigation cannot publish over the newest navigation', () => {
  const epochs = new NavigationEpoch()
  const first = epochs.begin(); const second = epochs.begin()
  assert.equal(epochs.current(first), false); assert.equal(epochs.current(second), true)
})
function source<T>(initial: T): ListSource<T> & { set(value: T): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, set(next) { value = next; for (const listener of listeners) listener() } }
}
test('sidebar follows opened sessions while a pending explicit group navigation retains its target', () => {
  const sessionSource = source<SessionSnapshot>({ phase: 'ready', ids: Object.keys(sessions), byId: { ...sessions, a1: { ...sessions.a1, retainedBy: { mainView: 1 } } } })
  const workspaceSource = source<WorkspaceSnapshot>({ phase: 'ready', items: workspaces, archivedSessionIds: [], pinnedSessionIds: [] })
  const store = new GroupStore(sessionSource, workspaceSource)
  const snapshot: GroupSnapshot = { groups: [{ kind: 'normal', id: 'general', label: 'General', directory: 'a', path: '/a', order: 0 }, { kind: 'normal', id: 'sample', label: 'Sample', directory: 'b', path: '/b', order: 1 }, { kind: 'system', id: 'unassigned', label: 'Unassigned', order: 2 }], members, focus: [], allows: [] }
  store.replace(snapshot)
  const stop = store.watch()
  assert.equal(store.selectedId(), 'general')
  store.begin('sample')
  sessionSource.set({ ...sessionSource.getSnapshot() })
  assert.equal(store.selectedId(), 'sample')
  sessionSource.set({ phase: 'ready', ids: Object.keys(sessions), byId: { ...sessions, b1: { ...sessions.b1, retainedBy: { mainView: 1 } } } })
  store.finish()
  assert.equal(store.selectedId(), 'sample')
  workspaceSource.set({ ...workspaceSource.getSnapshot(), items: [workspaces[0]] })
  assert.equal(store.selectedId(), 'unassigned')
  stop()
})
