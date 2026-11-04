import assert from 'node:assert/strict'
import test from 'node:test'
import { consolePageFromHash, consolePageHash } from '../src/navigation.ts'
test('console navigation preserves repository state only when staying in that column', () => {
  const hash = '#console=project-code-repositories&repo=1&sha=abc&path=src'
  assert.equal(consolePageFromHash(hash), 'project-code-repositories')
  assert.equal(consolePageHash(hash, 'project-code-repositories'), hash)
  assert.equal(consolePageHash(hash, 'project-management'), '#console=project-management')
  assert.equal(consolePageFromHash('#unrelated-anchor'), undefined)
  assert.equal(consolePageFromHash('#console=../settings'), undefined)
})
