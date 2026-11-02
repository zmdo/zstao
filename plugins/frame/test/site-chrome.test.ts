import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_TITLE } from '../src/site.ts'
import { nextDocumentTitle } from '../src/site-chrome.ts'

test('a harness tab title takes the saved site name', () => {
  assert.equal(nextDocumentTitle(DEFAULT_TITLE, '策略控制台', DEFAULT_TITLE), '策略控制台')
  assert.equal(nextDocumentTitle('DeepSeek Harness', '策略控制台', DEFAULT_TITLE), '策略控制台')
  assert.equal(nextDocumentTitle(`周报 — ${DEFAULT_TITLE}`, '策略控制台', DEFAULT_TITLE), '周报 — 策略控制台')
  assert.equal(nextDocumentTitle('周报 — DeepSeek Harness', '策略控制台', DEFAULT_TITLE), '周报 — 策略控制台')
  assert.equal(nextDocumentTitle('周报 — 策略控制台', '控制台', '策略控制台'), '周报 — 控制台')
  assert.equal(nextDocumentTitle('策略控制台', '控制台', '策略控制台'), '控制台')
})

test('a title harness did not write stays as it is', () => {
  assert.equal(nextDocumentTitle('安装', '策略控制台', '策略控制台'), '安装')
  assert.equal(nextDocumentTitle('周报 — 策略控制台', '策略控制台', '策略控制台'), '周报 — 策略控制台')
})
