import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_TITLE, loadSite, saveSite, siteDraft, siteView } from '../src/site.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('an empty record shows the default title and no custom icon', () => {
  assert.equal(DEFAULT_TITLE, 'Cyber Evolving System')
  assert.deepEqual(siteView(undefined), { title: DEFAULT_TITLE, icon: '' })
  assert.deepEqual(siteView({ title: '  ', icon: '' }), { title: DEFAULT_TITLE, icon: '' })
  assert.deepEqual(siteView({ title: '策略控制台', icon: PNG }), { title: '策略控制台', icon: PNG })
})

test('the default title is stored blank and a bad icon is refused', () => {
  assert.deepEqual(siteDraft({ title: `  ${DEFAULT_TITLE}  `, icon: '' }), { ok: true, title: '', icon: '' })
  assert.deepEqual(siteDraft({ title: '策略控制台', icon: PNG }), { ok: true, title: '策略控制台', icon: PNG })
  assert.equal(siteDraft({ title: 'x'.repeat(81), icon: '' }).ok, false)
  assert.equal(siteDraft({ title: '策略控制台', icon: 'https://example.test/icon.svg' }).ok, false)
  assert.equal(siteDraft({ title: '策略控制台', icon: 'data:image/png;base64,%%%' }).ok, false)
})

test('the site row is read and replaced as one record', async () => {
  let stored = { title: '', icon: '' }
  const db = {
    async query(sql: string, params?: unknown[]) {
      if (sql.startsWith('select')) return { rows: [stored] }
      stored = { title: String(params?.[0]), icon: String(params?.[1]) }
      return { rows: [] }
    },
  }
  assert.deepEqual(await loadSite(db), { title: '', icon: '' })
  await saveSite(db, '策略控制台', PNG)
  assert.deepEqual(await loadSite(db), { title: '策略控制台', icon: PNG })
})
