import assert from 'node:assert/strict'
import test from 'node:test'
import { landingChoice, landingDraft, landingLabel, landingPages, loadLanding, loadSidebar, preferencePatch, saveLanding, saveSidebar } from '../src/landing.ts'
import type { NavGroup, PageRoute } from '../src/pages.ts'

function page(key: string, label: string, group: string, groupLabel: string, order: number): PageRoute {
  return { key, label, order, group, groupLabel, placement: 'nav', icon: '' }
}

function group(id: string, label: string, order: number, pages: PageRoute[], placement: 'nav' | 'footer' = 'nav'): NavGroup {
  return { id, label, placement, order, icon: '', pages }
}

test('landing choices are pages, and a group with children lists each child', () => {
  const pages = landingPages({
    nav: [group('agent', 'Harness', 0, [
      page('agent-chat', '会话', 'agent', 'Harness', 0),
      page('archive', '档案', 'agent', 'Harness', 1),
    ]), group('markets', '行情', 30, [
      page('markets', '行情', 'markets', '行情', 30),
    ])],
    footer: [group('platform', '平台设置', 0, [
      page('general', '通用', 'platform', '平台设置', 0),
      page('menu', '菜单', 'platform', '平台设置', 2),
    ], 'footer')],
  })
  assert.deepEqual(pages.map(item => landingLabel(item, pages)), [
    'Harness / 会话',
    'Harness / 档案',
    '行情',
    '平台设置 / 通用',
    '平台设置 / 菜单',
  ])
  assert.equal(landingChoice('missing', pages), 'agent-chat')
  assert.equal(landingChoice('menu', pages), 'menu')
})

test('a landing page key must be a single token', () => {
  assert.deepEqual(landingDraft({ page: 'agent-chat' }), { ok: true, page: 'agent-chat' })
  assert.equal(landingDraft({ page: 'Harness / 会话' }).ok, false)
  assert.equal(landingDraft({}).ok, false)
})

test('the sidebar defaults to collapsed and only accepts the two modes', async () => {
  assert.equal(preferencePatch({ sidebar: 'expanded' }).ok, true)
  assert.equal(preferencePatch({ sidebar: 'wide' }).ok, false)
  assert.equal(preferencePatch({}).ok, false)
  const writes: unknown[][] = []
  const db = {
    query: async (_sql: string, params?: unknown[]) => {
      writes.push(params ?? [])
      return { rows: [] }
    },
  }
  assert.equal(await loadSidebar(db), 'collapsed')
  await saveSidebar(db, 'expanded')
  assert.deepEqual(writes[1], [false])
})

test('a missing landing row stays on the Harness conversation', async () => {
  const writes: unknown[][] = []
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      writes.push(params ?? [])
      if (sql.startsWith('select')) return { rows: [] }
      return { rows: [] }
    },
  }
  assert.equal(await loadLanding(db), 'agent-chat')
  await saveLanding(db, 'archive')
  assert.deepEqual(writes[1], ['archive'])
})
