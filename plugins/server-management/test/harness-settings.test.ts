import assert from 'node:assert/strict'
import test from 'node:test'
import { validateExecLimits } from '../src/host/harness/settings-service.ts'

const valid = {
  defaultTimeoutMs: 30000,
  maxTimeoutMs: 120000,
  defaultCommandBytes: 8192,
  maxCommandBytes: 65536,
  defaultOutputBytes: 65536,
  maxOutputBytes: 1048576,
  rsyncDeniedFlags: ['-e', '--delete'],
}

test('execution limits require positive integers and defaults within maxima', () => {
  assert.deepEqual(validateExecLimits(valid), valid)
  for (const input of [
    { ...valid, maxTimeoutMs: 120001 },
    { ...valid, defaultTimeoutMs: 120001 },
    { ...valid, maxCommandBytes: 65537 },
    { ...valid, defaultOutputBytes: 1048577 },
    { ...valid, defaultCommandBytes: 0 },
  ])
    assert.throws(() => validateExecLimits(input))
})
