import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ICON_DARK, DEFAULT_ICON_LIGHT, DEFAULT_TITLE } from '@smp/console-frame/site-mark'
import { INSTALL_PAGE } from '../src/page.ts'

test('the install page uses the site name and the hub mark', () => {
  assert.equal(DEFAULT_TITLE, 'Cyber Evolving System')
  assert.equal(INSTALL_PAGE.includes(`<title>${DEFAULT_TITLE}</title>`), true)
  assert.equal(INSTALL_PAGE.includes(DEFAULT_ICON_LIGHT), true)
  assert.equal(INSTALL_PAGE.includes(DEFAULT_ICON_DARK), true)
  assert.equal(INSTALL_PAGE.includes('class="brand">Cyber Evolving System'), true)
  assert.equal(INSTALL_PAGE.includes('<h1>安装</h1>'), true)
  assert.equal(INSTALL_PAGE.includes('/favicon.svg'), false)
})
