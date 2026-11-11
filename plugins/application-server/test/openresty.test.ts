import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { openRestyVersions as versions } from '../src/versions.ts'

test('OpenResty version rules retain and order the fourth version component', () => {
  assert.equal(versions.compare('1.27.1.9', '1.27.1.10'), -1)
  assert.equal(versions.contains({ kind: 'series', prefix: '1.27.1' }, '1.27.1.2'), true)
  assert.equal(versions.contains({ kind: 'minimum', version: '1.27.1.3' }, '1.27.1.2'), false)
  assert.deepEqual(versions.intersect([
    { kind: 'series', prefix: '1.27' }, { kind: 'minimum', version: '1.27.1.2' },
  ]), { kind: 'range', minimum: '1.27.1.2', maximum: '1.27' })
  assert.equal(versions.intersect([{ kind: 'series', prefix: '1.27' }, { kind: 'series', prefix: '1.29' }]), null)
  assert.equal(versions.isSubset({ kind: 'exact', version: '1.27.1.2' }, { kind: 'series', prefix: '1.27' }), true)
  assert.equal(versions.isSingleton({ kind: 'exact', version: '1.27.1.2' }), true)
  assert.equal(versions.atInclusiveUpperBound({ kind: 'range', minimum: '1.27', maximum: '1.27.1.2' }, '1.27.1.2'), true)
  for (const bad of ['1.27.1', '1.27.1.2.0', '1.27.01.2', '1.27.1.2-13', '1.27.1.NaN']) {
    assert.throws(() => versions.normalize(bad))
  }
  assert.throws(() => versions.validate({ kind: 'range', minimum: '1.29', maximum: '1.27' }))
})

test('gateway recipe preserves sites and restores the previous container after a failed replacement', () => {
  execFileSync('python3', ['-B', new URL('openresty_test.py', import.meta.url).pathname], { stdio: 'pipe' })
})
