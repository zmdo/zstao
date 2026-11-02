import assert from 'node:assert/strict'
import test from 'node:test'
import { generalRowIds, sectionNav } from '../src/sections.ts'

test('registered harness sections become the settings nav', () => {
  const nav = sectionNav([
    { options: { id: 'models', label: () => '模型', order: 10 } },
    { options: { id: 'general', label: '通用设置', order: 0 } },
    { options: { id: 'plugins', label: '内置插件', order: 20 } },
    { options: { id: 'hidden' } },
    { options: { id: 'blank', label: '' } },
  ])
  assert.deepEqual(nav.map(item => item.id), ['general', 'plugins'])
  assert.equal(nav[0]?.label, '通用设置')
})

test('language and appearance stay out of the general section', () => {
  const rows = generalRowIds([
    { options: { id: 'language', order: 0 } },
    { options: { id: 'appearance', order: 10 } },
    { options: { id: 'font-size', order: 11 } },
    { options: { id: 'permission', order: 5 } },
  ])
  assert.deepEqual(rows, ['permission', 'font-size'])
})
