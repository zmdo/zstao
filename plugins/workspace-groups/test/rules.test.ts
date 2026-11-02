import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensureDirectory, resolveGroupDirectory } from '../src/paths.ts'
import {
  GENERAL_GROUP_ID,
  GENERAL_GROUP_LABEL,
  claimWorkspace,
  focusedWorkspace,
  groupLabelOf,
  judgingGroup,
  normalizeAllow,
  pagesHidden,
  planDefault,
  pluginUsable,
  rememberAllow,
  rememberGroup,
  sessionWorkspaceGroup,
  toolRefusal,
  ungroupedIds,
  type AllowSpec,
  type MemberRow,
} from '../src/rules.ts'

const home = '/Users/ada'

test('the general directory resolves under the home directory', () => {
  assert.equal(resolveGroupDirectory(home, '.smp/workspaces'), join(home, '.smp/workspaces'))
})

test('a directory outside the home is rejected', () => {
  assert.throws(() => resolveGroupDirectory(home, '..'), /主目录/)
  assert.throws(() => resolveGroupDirectory(home, '/tmp/workspaces'), /主目录/)
  assert.throws(() => resolveGroupDirectory(home, '~/.smp/workspaces'), /主目录/)
  assert.throws(() => resolveGroupDirectory(home, '   '), /不能为空/)
})

test('a file along the bound path is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smp-groups-'))
  await writeFile(join(root, 'blocked'), 'x')
  await assert.rejects(() => ensureDirectory(join(root, 'blocked', 'child')), /已经是文件/)
})

test('a new workspace joins the current group and an existing one is not reassigned', () => {
  const members: MemberRow[] = [{ workspaceId: 'old', groupId: 'sample', isDefault: false }]
  const added = claimWorkspace(members, 'new', GENERAL_GROUP_ID, '临时工作区组')
  assert.deepEqual(added, { ok: true, insert: true })
  const kept = claimWorkspace(members, 'old', GENERAL_GROUP_ID, '临时工作区组')
  assert.equal(kept.ok, false)
  if (!kept.ok) assert.match(kept.detail, /临时工作区组/)
})

test('workspaces without a membership row are discoverable but not auto-assigned', () => {
  const members: MemberRow[] = [{ workspaceId: 'kept', groupId: 'sample', isDefault: false }]
  assert.deepEqual(ungroupedIds(['kept', 'loose'], members), ['loose'])
})

test('a missing default is created and an existing workspace at that path is adopted', () => {
  assert.deepEqual(planDefault([], GENERAL_GROUP_ID, undefined), { action: 'create' })
  assert.deepEqual(planDefault([], 'sample', 'already'), { action: 'mark', workspaceId: 'already' })
  const marked: MemberRow[] = [{ workspaceId: 'already', groupId: 'sample', isDefault: true }]
  assert.deepEqual(planDefault(marked, 'sample', 'already'), { action: 'keep' })
})

test('switching enters the focused workspace and falls back to the default', () => {
  const members: MemberRow[] = [
    { workspaceId: 'default', groupId: 'sample', isDefault: true },
    { workspaceId: 'other', groupId: 'sample', isDefault: false },
  ]
  assert.equal(focusedWorkspace(members, 'sample', 'other'), 'other')
  assert.equal(focusedWorkspace(members, 'sample', 'gone'), 'default')
  assert.equal(focusedWorkspace(members, 'sample', undefined), 'default')
})

test('a workspace without a membership row is labeled as the general group', () => {
  const label = groupLabelOf(undefined, [], [])
  assert.equal(label, GENERAL_GROUP_LABEL)
  assert.equal(`${label}/默认工作区`, '默认组/默认工作区')
})

test('a plugin that never calls allow is usable in every group', () => {
  const registered = new Set([GENERAL_GROUP_ID, 'sample'])
  assert.equal(pluginUsable([], 'bash', GENERAL_GROUP_ID, registered), true)
  assert.equal(pluginUsable([], 'bash', 'sample', registered), true)
})

test('allow for one group hides the page and refuses the tool in the other group', () => {
  const allows: AllowSpec[] = [normalizeAllow({ id: 'gate', groups: ['sample'], pages: ['workspace-group-gate'] })]
  const registered = new Set([GENERAL_GROUP_ID, 'sample'])
  assert.deepEqual(pagesHidden(allows, GENERAL_GROUP_ID, registered), ['workspace-group-gate'])
  assert.deepEqual(pagesHidden(allows, 'sample', registered), [])
  assert.equal(pluginUsable(allows, 'gate', GENERAL_GROUP_ID, registered), false)
  assert.equal(pluginUsable(allows, 'gate', 'sample', registered), true)
  assert.match(toolRefusal('默认组'), /默认组/)
  assert.equal(allows[0]?.pages.includes('workspace-group-gate'), true)
})

test('allow may name a group that is not registered yet and still matches nothing', () => {
  const allows = rememberAllow([], normalizeAllow({ id: 'gate', groups: ['missing'], pages: ['gate-page'] }))
  const registered = new Set([GENERAL_GROUP_ID])
  assert.equal(pluginUsable(allows, 'gate', GENERAL_GROUP_ID, registered), false)
  assert.equal(pluginUsable(allows, 'gate', 'missing', registered), false)
  assert.throws(() => rememberAllow(allows, normalizeAllow({ id: 'gate', groups: ['missing'] })), /已经登记过/)
})

test('an open session is judged by its own group, not the sidebar selection', () => {
  const sessions = { byId: { a: { id: 'a', cwd: '/work', retainedBy: { mainView: 1 } } } }
  const workspaces = [{ workspaceId: 'ws', path: '/work', title: '工作', sessionIds: ['a'] }]
  const members: MemberRow[] = [{ workspaceId: 'ws', groupId: 'sample', isDefault: false }]
  assert.equal(sessionWorkspaceGroup(sessions, workspaces, members), 'sample')
  assert.equal(judgingGroup(sessionWorkspaceGroup(sessions, workspaces, members), GENERAL_GROUP_ID), 'sample')
  assert.equal(judgingGroup(undefined, GENERAL_GROUP_ID), GENERAL_GROUP_ID)
})

test('registering the same group twice fails', () => {
  const spec = { id: GENERAL_GROUP_ID, label: GENERAL_GROUP_LABEL, directory: '.smp/workspaces', order: 0 }
  assert.throws(() => rememberGroup([spec], spec), /已经注册过/)
})
