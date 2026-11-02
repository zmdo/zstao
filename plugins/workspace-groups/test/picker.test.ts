import assert from 'node:assert/strict'
import test from 'node:test'
import { PickerController, pickerGroup, pickerWorkspaces, type PickerClient } from '../src/picker-controller.ts'
import { groupForSession } from '../src/rules.ts'
import type { GroupSnapshot, WorkspaceSnapshot } from '../src/contract.ts'

function fixture() {
  let main: string | undefined = 'a1'
  let selected = 'general'
  let ready = true
  const groups: GroupSnapshot = {
    groups: [
      { kind: 'normal', id: 'general', label: 'General', directory: 'a', path: '/a', order: 0 },
      { kind: 'normal', id: 'sample', label: 'Sample', directory: 'b', path: '/b', order: 1 },
      { kind: 'system', id: 'unassigned', label: 'Unassigned', order: 2 },
    ],
    members: [
      { workspaceId: 'a', groupId: 'general', directory: '/a', isDefault: true, lastSessionId: null },
      { workspaceId: 'b', groupId: 'sample', directory: '/b', isDefault: true, lastSessionId: null },
    ], focus: [], allows: [],
  }
  const snapshot: WorkspaceSnapshot = { phase: 'ready', archivedSessionIds: [], pinnedSessionIds: [], items: [
    { workspaceId: 'a', path: '/a', title: 'Same title', sessionIds: ['a1'] },
    { workspaceId: 'b', path: '/b', title: 'Same title', sessionIds: ['b1'] },
  ] }
  const navigation: { groupId: string; workspaceId: string }[] = []
  const additions: { groupId: string; path: string }[] = []
  const client: PickerClient = {
    store: { ready: () => ready, isEmpty: () => false, mainId: () => main, groupOf: id => groupForSession(id, snapshot.items, groups.members) },
    selectedId: () => selected,
    getSnapshot: () => groups,
    ctx: { workspaces: { list: { getSnapshot: () => snapshot } } },
    async enter(groupId, workspaceId) { navigation.push({ groupId, workspaceId }) },
    async addWorkspace(groupId, path) { additions.push({ groupId, path }); return snapshot.items.find(w => w.path === path)! },
  }
  return { client, groups, snapshot, navigation, additions, main: (id?: string) => { main = id }, selected: (id: string) => { selected = id }, ready: (value: boolean) => { ready = value } }
}

test('composer choices follow the actual conversation, including during a pending group switch', () => {
  const f = fixture()
  f.selected('sample')
  assert.equal(pickerGroup(f.client), 'general')
  assert.deepEqual(pickerWorkspaces(f.client).items.map(w => w.workspaceId), ['a'])
  f.main('b1')
  assert.deepEqual(pickerWorkspaces(f.client).items.map(w => w.workspaceId), ['b'])
  assert.equal(f.snapshot.items.length, 2)
})

test('cold start uses the selected group and pending ownership never exposes the global list', () => {
  const f = fixture()
  f.main(undefined); f.selected('sample')
  assert.deepEqual(pickerWorkspaces(f.client).items.map(w => w.workspaceId), ['b'])
  f.ready(false)
  assert.equal(pickerWorkspaces(f.client).phase, 'pending')
  assert.deepEqual(pickerWorkspaces(f.client).items, [])
})

test('keyboard or stale callbacks cannot pick another group or a removed workspace', async () => {
  const f = fixture()
  const picker = new PickerController(f.client)
  picker.observeOpen(true)
  await assert.rejects(() => picker.pick('b'), { code: 'workspace-group/picker-target' })
  await assert.rejects(() => picker.pick('gone'), { code: 'workspace-group/picker-target' })
  assert.deepEqual(f.navigation, [])
  await picker.pick('a')
  assert.deepEqual(f.navigation, [{ groupId: 'general', workspaceId: 'a' }])
})

test('a group change invalidates a menu opened for the former conversation', async () => {
  const f = fixture()
  const picker = new PickerController(f.client)
  picker.observeOpen(true)
  f.main('b1')
  await assert.rejects(() => picker.pick('a'), { code: 'workspace-group/picker-stale' })
  assert.deepEqual(f.navigation, [])
  picker.observeOpen(false); picker.observeOpen(true)
  await picker.pick('b')
  assert.deepEqual(f.navigation, [{ groupId: 'sample', workspaceId: 'b' }])
})

test('directory adoption keeps its opening group even after the native menu closes or another group opens', async () => {
  const f = fixture()
  const picker = new PickerController(f.client)
  picker.observeOpen(true); picker.observeOpen(false)
  f.main('b1')
  await picker.create('/a')
  assert.deepEqual(f.additions, [{ groupId: 'general', path: '/a' }])
  await picker.pick('a')
  assert.deepEqual(f.navigation, [{ groupId: 'general', workspaceId: 'a' }])
})

test('unassigned offers no workspace and rejects picks and creation without invoking either action', async () => {
  const f = fixture()
  f.main('orphan')
  assert.equal(pickerGroup(f.client), 'unassigned')
  assert.deepEqual(pickerWorkspaces(f.client).items, [])
  const picker = new PickerController(f.client)
  picker.observeOpen(true)
  await assert.rejects(() => picker.pick('a'), { code: 'workspace-group/system-readonly' })
  await assert.rejects(() => picker.create('/a'), { code: 'workspace-group/system-readonly' })
  assert.deepEqual(f.navigation, []); assert.deepEqual(f.additions, [])
})

test('a pending directory adoption cannot be submitted twice', async () => {
  const f = fixture()
  let complete!: () => void
  const settled = new Promise<void>(resolve => { complete = resolve })
  const original = f.client.addWorkspace
  f.client.addWorkspace = async (group, path) => { await settled; return original(group, path) }
  const picker = new PickerController(f.client)
  picker.observeOpen(true)
  const first = picker.create('/a')
  await assert.rejects(() => picker.create('/a'), { code: 'workspace-group/busy' })
  complete(); await first
  assert.equal(f.additions.length, 1)
})

test('canceling the native chooser creates nothing and reopening captures the new group', async () => {
  const f = fixture()
  const picker = new PickerController(f.client)
  picker.observeOpen(true); picker.observeOpen(false)
  assert.deepEqual(f.additions, [])
  f.main('b1'); picker.observeOpen(true)
  await picker.create('/b')
  assert.deepEqual(f.additions, [{ groupId: 'sample', path: '/b' }])
})
