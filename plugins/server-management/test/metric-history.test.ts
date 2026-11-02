import assert from 'node:assert/strict'
import test from 'node:test'
import { metricRange } from '../src/host/servers/metric-history.ts'

test('metric history accepts only supported ranges', () => {
  assert.equal(metricRange('1h'), '1h')
  assert.equal(metricRange('7d'), '7d')
  assert.equal(metricRange('30d'), '30d')
  assert.equal(metricRange(null), null)
  assert.equal(metricRange('90d'), null)
})
