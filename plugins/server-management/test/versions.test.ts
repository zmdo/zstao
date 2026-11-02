import assert from 'node:assert/strict'
import test from 'node:test'
import { stableVersions as v } from '../src/shared/versions.ts'

test('stable product versions distinguish exact, series and inclusive partial upper bounds', () => {
  assert.equal(v.contains({ kind: 'series', prefix: '27.3' }, '27.3.99'), true)
  assert.equal(v.contains({ kind: 'series', prefix: '27' }, '28.0.0'), false)
  assert.equal(v.contains({ kind: 'range', minimum: '27.3', maximum: '28' }, '28.99.99'), true)
  assert.equal(v.contains({ kind: 'range', minimum: '27', maximum: '28.3.1' }, '28.3.2'), false)
  assert.equal(v.atInclusiveUpperBound({ kind: 'range', minimum: '27', maximum: '28.3.1' }, '28.3.1'), true)
  assert.equal(v.atInclusiveUpperBound({ kind: 'series', prefix: '27' }, '27.99.99'), false)
  assert.equal(v.isSubset({ kind: 'series', prefix: '27.3' }, { kind: 'series', prefix: '27' }), true)
  assert.equal(v.isSubset({ kind: 'any' }, { kind: 'minimum', version: '27' }), false)
  assert.deepEqual(
    v.intersect([
      { kind: 'minimum', version: '27.3' },
      { kind: 'series', prefix: '27' },
    ]),
    { kind: 'range', minimum: '27.3.0', maximum: '27' },
  )
  assert.equal(
    v.intersect([
      { kind: 'exact', version: '27.3.1' },
      { kind: 'series', prefix: '28' },
    ]),
    null,
  )
  for (const version of ['27.3', '27.3.1-beta', '1:27.3.1-1', '027.3.1']) assert.throws(() => v.normalize(version))
  assert.throws(() => v.validate({ kind: 'range', minimum: '28', maximum: '27' }))
})
