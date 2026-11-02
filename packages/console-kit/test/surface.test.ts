import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const surface = readFileSync(new URL('../src/surface.css', import.meta.url), 'utf8')
const content = readFileSync(new URL('../src/content.css', import.meta.url), 'utf8')

test('console cards and harness sections share one stylesheet', () => {
  assert.match(content, /\.smp-console \.panel \{/)
  assert.match(content, /\.smp-console button\.primary/)
  assert.match(surface, /\.smp-console \.smp-surface \[class\*="_title"\]/)
  assert.match(surface, /\.smp-console \.smp-surface \[class\*="_primaryButton"\]/)
  assert.equal(surface.includes('.smp-models'), false)
})
