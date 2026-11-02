import assert from 'node:assert/strict'
import test from 'node:test'
import { detectionResult } from '../src/shared/detection-result.ts'
import { type DetectionResult } from '../src/shared/dto/upgrades.ts'

const check: DetectionResult = {
  server_id: 'test-server',
  server_name: 'Test server',
  software_key: 'builtin/docker-engine',
  last_check_at: '2026-10-19T17:50:28.710Z',
  check_error: null,
  check_snapshot: { reason: null, eligible: [] },
}
test('the latest SSH error takes precedence over the previous successful check and follows the current language', () => {
  const input = {
    ...check,
    check_snapshot: { reason: null, eligible: [{}] },
    check_error: { error: { code: 'ssh_auth_failed', detail: '旧中文错误', params: {} } },
  }
  const zh = detectionResult('zh', input),
    en = detectionResult('en', input)
  assert.equal(zh.state, 'failed')
  assert.equal(en.state, 'failed')
  assert.deepEqual(zh.reasons, ['SSH 认证失败，请检查用户名、私钥或口令。'])
  assert.deepEqual(en.reasons, ['SSH authentication failed. Check the username, private key or password.'])
})
test('candidate error lists render deduplicated messages and unknown envelopes never become JSON', () => {
  const input = {
    ...check,
    check_error: {
      reason: null,
      errors: [
        { code: 'plan_conflict', params: {} },
        { code: 'plan_conflict', params: {} },
        { detail: 'Package metadata unavailable' },
      ],
    },
  }
  assert.deepEqual(detectionResult('en', input).reasons, [
    'The software change requires a new preflight and confirmation.',
    'Package metadata unavailable',
  ])
  const unknown = detectionResult('en', {
    ...check,
    check_error: { unsupported: { raw: 'private implementation data' } },
  })
  assert.equal(unknown.state, 'failed')
  assert.equal(unknown.reasons.length, 1)
  assert.equal(unknown.reasons[0]!.includes('raw'), false)
})
test('range limits, missing software, available targets and no check are distinct outcomes', () => {
  for (const reason of [
    'fixed_version',
    'range_ceiling',
    'not_installed',
    'version_conflict',
    'recipe_unavailable',
  ]) {
    const result = detectionResult('zh', { ...check, check_snapshot: { reason, eligible: [] } })
    assert.equal(result.state, 'blocked')
    assert.equal(result.reasons.length, 1)
  }
  assert.equal(
    detectionResult('en', { ...check, check_snapshot: { reason: null, eligible: [{}] } }).state,
    'available',
  )
  assert.equal(detectionResult('en', check).state, 'current')
  assert.equal(detectionResult('en', { ...check, check_snapshot: null }).state, 'unknown')
  const failed = detectionResult('en', {
    ...check,
    check_snapshot: { reason: 'detection_failed', before: { state: 'unknown', detail: 'Probe timed out' } },
  })
  assert.deepEqual(failed.reasons, ['Probe timed out'])
})
