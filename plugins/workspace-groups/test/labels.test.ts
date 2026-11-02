import assert from 'node:assert/strict'
import test from 'node:test'
import { groupCopy, localizedGroupLabel } from '../src/copy.ts'
import { generalGroup } from '../src/service.ts'
import { groupLabelOf, normalizeGroup } from '../src/rules.ts'

test('built-in general group labels follow the platform language, including archive fallback', () => {
  assert.equal(localizedGroupLabel(generalGroup, 'zh'), '默认组')
  assert.equal(localizedGroupLabel(generalGroup, 'en'), 'Default Group')
  assert.equal(groupLabelOf(undefined, [], [], 'en'), 'Default Group')
  assert.equal(groupCopy('en').unassigned, 'Unassigned')
  assert.equal(generalGroup.id, 'general')
})

test('a plugin can contribute translated labels without changing identity, order or directory', () => {
  const input = { id: 'ops', label: '运维工作区组', labelI18n: { zh: ' 运维工作区组 ', en: ' Operations ' }, directory: '.smp/ops', order: 20 }
  const group = normalizeGroup(input)
  input.labelI18n.en = 'mutated'
  assert.equal(localizedGroupLabel(group, 'zh'), '运维工作区组')
  assert.equal(localizedGroupLabel(group, 'en'), 'Operations')
  assert.equal(groupLabelOf('workspace', [{ workspaceId: 'workspace', groupId: 'ops', isDefault: true }], [group], 'en'), 'Operations')
  assert.deepEqual([group.id, group.directory, group.order], ['ops', '.smp/ops', 20])
})

test('literal labels stay intact and missing translations fall back without guessing from Chinese text', () => {
  assert.equal(localizedGroupLabel({ label: '默认组' }, 'en'), '默认组')
  assert.equal(localizedGroupLabel({ label: 'Plugin fallback', labelI18n: { zh: '插件名称' } }, 'en'), 'Plugin fallback')
  assert.equal(localizedGroupLabel({ label: 'Name', labelI18n: { en: 'English' } }, 'zh'), 'Name')
})

test('invalid translation metadata is rejected at registration instead of displaying an empty name', () => {
  const input = { id: 'ops', label: 'Ops', directory: '.smp/ops' }
  assert.throws(() => normalizeGroup({ ...input, labelI18n: { en: '   ' } }), /名称不能为空/)
  assert.throws(() => normalizeGroup({ ...input, labelI18n: { 'en-US': 'Ops' } } as never), /语言键/)
  assert.throws(() => normalizeGroup({ ...input, labelI18n: null } as never), /语言键/)
})
