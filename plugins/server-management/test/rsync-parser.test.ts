import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRsyncCommand } from '../src/host/harness/rsync.ts'

test('rsync command parsing keeps argv and finds a remote operand', () => {
  const parsed = parseRsyncCommand('rsync -avz --partial "./dist dir/" ubuntu@example.test:/srv/app/', [])
  assert.deepEqual(parsed.argv, ['rsync', '-avz', '--partial', './dist dir/', 'ubuntu@example.test:/srv/app/'])
  assert.deepEqual(parsed.remote.map((item) => [item.user, item.host, item.path]), [['ubuntu', 'example.test', '/srv/app/']])
})

test('short rsync options are expanded before checking denied flags', () => {
  const parsed = parseRsyncCommand('rsync -avze "ssh -i key" ./a host:/b', [])
  assert.deepEqual(parsed.flags, ['-a', '-v', '-z', '-e'])
  assert.throws(() => parseRsyncCommand('rsync -avze "ssh -i key" ./a host:/b', ['--rsh']), /disabled by policy/)
})

test('long options with values and delete variants are checked', () => {
  assert.throws(() => parseRsyncCommand('rsync --delete-after /tmp/a host:/b', ['--delete']), /disabled by policy/)
  assert.throws(() => parseRsyncCommand('rsync --rsh=ssh /tmp/a host:/b', ['--rsh']), /disabled by policy/)
  assert.throws(() => parseRsyncCommand('rsync --delete /tmp/a host:/b', ['--delete']), /disabled by policy/)
})

test('shell syntax and a missing remote are rejected', () => {
  assert.throws(() => parseRsyncCommand('rsync -a /tmp/a host:/b; rm -rf /', []), /Shell operators/)
  assert.throws(() => parseRsyncCommand('rsync -a "$HOME/a" host:/b', []), /Shell expansion/)
    assert.throws(() => parseRsyncCommand('rsync -a /tmp/a /tmp/b', []), /remote/)
  assert.throws(() => parseRsyncCommand('ssh host', []), /start with rsync/)
})

test('quoted paths and -- operands are retained', () => {
  const parsed = parseRsyncCommand('rsync -a -- "a b" "host:/x y"', [])
  assert.deepEqual(parsed.operands, ['a b', 'host:/x y'])
  assert.equal(parsed.remote[0]?.path, '/x y')
})
