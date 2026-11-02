import assert from 'node:assert/strict'
import test from 'node:test'
import { clampPage, globalRows, jumpTarget, moduleShortName, pageCount, pageSlice, rowsByStatus } from '../src/rows.ts'

test('a package name loses its scope and harness prefix', () => {
  assert.equal(moduleShortName('@deepseek-ai/dsh-host-plugin-inventory'), 'plugin-inventory')
  assert.equal(moduleShortName('cordis-plugin-timer'), 'timer')
})

test('the global list keeps loader order and leaves preset compositions out', () => {
  const entries = [
    { entryId: 'inventory', moduleName: '@deepseek-ai/dsh-host-plugin-inventory', enabled: true, fiberPhase: 'active' as const, meta: { title: { zh: '插件清单', en: 'Inventory' }, description: { zh: '只读', en: 'Read only' } } },
    { entryId: 'timer', moduleName: 'cordis-plugin-timer', enabled: false, fiberPhase: null, meta: { title: 'cordis-plugin-timer' } },
    { entryId: 'broken', moduleName: 'dsh-client-ui-chat', enabled: true, fiberPhase: 'failed' as const },
  ]
  const presets = [{ id: 'default', name: '默认', rows: [{ moduleName: 'cordis-plugin-timer', enabled: true as const }] }]
  const rows = globalRows(entries, presets, 'zh', '')
  assert.deepEqual(rows.map(row => row.title), ['插件清单', 'timer', 'ui-chat'])
  assert.equal(rows[0]?.description, '只读')
  assert.equal(rows[0]?.status, 'enabled')
  assert.equal(rows[1]?.status, 'preset')
  assert.deepEqual(rows[1]?.enabledIn, ['默认'])
  assert.equal(rows[2]?.status, 'failed')
  assert.deepEqual(globalRows(entries, presets, 'en', 'inventory').map(row => row.id), ['inventory'])
  assert.deepEqual(globalRows(entries, presets, 'zh', '不存在'), [])
})

test('a page stays inside the filtered list', () => {
  const rows = Array.from({ length: 25 }, (_, index) => index)
  assert.equal(pageCount(25, 10), 3)
  assert.equal(pageCount(0, 10), 1)
  assert.equal(clampPage(9, 25, 10), 3)
  assert.deepEqual(pageSlice(rows, 2, 10), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  assert.deepEqual(pageSlice(rows, 9, 10), [20, 21, 22, 23, 24])
})

test('details keep the module identity and only a data-image icon', () => {
  const rows = globalRows([{
    entryId: 'timer',
    moduleName: 'cordis-plugin-timer',
    enabled: false,
    fiberPhase: null,
    meta: { error: 'icon missing', icon: 'https://example.test/icon.svg' },
  }, {
    entryId: 'marked',
    moduleName: 'cordis-plugin-marked',
    enabled: true,
    fiberPhase: 'active',
    meta: { icon: 'data:image/png;base64,aa' },
  }], [], 'zh', '')
  assert.equal(rows[0]?.metaError, 'icon missing')
  assert.equal(rows[0]?.icon, '')
  assert.equal(rows[0]?.enabled, false)
  assert.equal(rows[0]?.fiberPhase, null)
  assert.equal(rows[1]?.icon, 'data:image/png;base64,aa')
  assert.equal(rows[1]?.moduleName, 'cordis-plugin-marked')
})

test('status keeps matching rows and a page jump stays inside the list', () => {
  const entries = [
    { entryId: 'inventory', moduleName: 'inventory', enabled: true, fiberPhase: 'active' as const },
    { entryId: 'timer', moduleName: 'cordis-plugin-timer', enabled: false, fiberPhase: null },
    { entryId: 'broken', moduleName: 'broken', enabled: true, fiberPhase: 'failed' as const },
  ]
  const presets = [{ id: 'default', name: '默认', rows: [{ moduleName: 'cordis-plugin-timer', enabled: true as const }] }]
  const rows = globalRows(entries, presets, 'zh', '')
  assert.deepEqual(rowsByStatus(rows, 'all').map(row => row.id), ['inventory', 'timer', 'broken'])
  assert.deepEqual(rowsByStatus(rows, 'failed').map(row => row.id), ['broken'])
  assert.deepEqual(rowsByStatus(rows, 'preset').map(row => row.id), ['timer'])
  assert.equal(jumpTarget('3', 25, 10), 3)
  assert.equal(jumpTarget('9', 25, 10), 3)
  assert.equal(jumpTarget('0', 25, 10), undefined)
  assert.equal(jumpTarget('abc', 25, 10), undefined)
})
