import assert from 'node:assert/strict'
import test from 'node:test'
import {parsePolicies,restrictLease,detectionEligibility} from '../src/host/definitions/policies.ts'
import { componentFixture } from './fixtures.ts'
import {type TypeLease} from '../src/host/definitions/model.ts'
import {preparePlan} from '../src/host/recipes/planning.ts'
import {detectUpdates} from '../src/host/upgrades/detect.ts'
import {type SshSession} from '../src/host/remote/ssh.ts'
const os = { family: 'builtin/ubuntu', version: '24.04', architecture: 'x86_64' }
function lease(): TypeLease {
  const c = componentFixture('tool')
  c.versions = { kind: 'series', prefix: '27' }
  c.actions = ['install', 'upgrade', 'replace']
  return {
    components: [c],
    signature: 'base',
    type: {
      key: 'test/node',
      name_i18n: { zh: '测试', en: 'Test' },
      software: [],
      supportedOs: { kind: 'all' },
    },
    release() {},
  }
}
test('policy boundaries inherit the provider and only narrow its allowance', () => {
  const source = lease(),
    key = source.components[0]!.software_key
  assert.equal(
    restrictLease(source, [{ software_key: key, restriction: { kind: 'any' }, detect_updates: true }])
      .signature,
    'base',
  )
  const narrowed = restrictLease(source, [
    { software_key: key, restriction: { kind: 'series', prefix: '27.3' }, detect_updates: true },
  ])
  assert.notEqual(narrowed.signature, 'base')
  assert.deepEqual(source.components[0]!.versions, { kind: 'series', prefix: '27' })
  assert.deepEqual(narrowed.components[0]!.versions, { kind: 'range', minimum: '27.3.0', maximum: '27.3' })
  assert.throws(
    () =>
      restrictLease(source, [
        { software_key: key, restriction: { kind: 'minimum', version: '27.3' }, detect_updates: false },
      ]),
    { code: 'policy_widens_type' },
  )
  assert.throws(
    () =>
      restrictLease(source, [
        { software_key: 'other/key', restriction: { kind: 'any' }, detect_updates: false },
      ]),
    { code: 'policy_invalid' },
  )
  for (const value of [
    null,
    {},
    [{ software_key: key, detect_updates: 'yes', restriction: { kind: 'any' } }],
    [{ software_key: key, detect_updates: false, restriction: { kind: 'exact', version: 42 } }],
  ])
    assert.throws(() => parsePolicies(value), { code: 'policy_invalid' })
})
test('fixed versions and a full upper bound disable detection; a series and repository latest do not', () => {
  const c = lease().components[0]!
  assert.equal(
    detectionEligibility({ ...c, versions: { kind: 'exact', version: '27.3.1' } }, '27.3.1'),
    'fixed_version',
  )
  assert.equal(
    detectionEligibility({ ...c, versions: { kind: 'range', minimum: '27', maximum: '27.3.1' } }, '27.3.1'),
    'range_ceiling',
  )
  assert.equal(detectionEligibility({ ...c, versions: { kind: 'series', prefix: '27.3' } }, '27.3.1'), null)
  assert.equal(detectionEligibility({ ...c, versions: { kind: 'any' } }, '27.3.1'), null)
})
function remote(version: string, candidates = ['27.3.2', '28.1.0']) {
  const operations: string[] = [],
    c = lease().components[0]!
  const session: SshSession = {
    fingerprint: 'test',
    close() {},
    async shell() {
      throw Error('unexpected')
    },
    async putScript() {
      throw Error('unexpected')
    },
    async exec(_cmd, _timeout, options) {
      const r = JSON.parse(options!.stdin!)
      operations.push(r.operation)
      const candidate = (version: string) => ({
        version,
        targetIdentity: 'pkg=' + version,
        packages: [],
        channel: 'stable',
      })
      const before = {
        state: 'installed',
        version,
        targetIdentity: 'pkg=' + version,
        packages: [],
        healthy: true,
      }
      const result =
        r.operation === 'detect'
          ? { operation: 'detect', result: before }
          : r.operation === 'list-candidates'
            ? { operation: 'list-candidates', candidates: candidates.map(candidate) }
            : {
                operation: 'resolve',
                change: {
                  software: c.software_key,
                  recipe: c.recipe,
                  recipeRevision: c.revision,
                  action: r.action,
                  before: r.installed,
                  target: r.target,
                  dependencies: [],
                  effects: [],
                  payload: null,
                },
                additionalRequirements: [],
              }
      return { code: 0, stdout: JSON.stringify(result), stderr: '' }
    },
  }
  return { session, operations }
}
test('upgrade preflight rejects equal versions, downgrades, missing software and targets outside the effective range', async () => {
  const l = lease(),
    key = l.components[0]!.software_key,
    r = remote('27.3.1')
  await assert.rejects(preparePlan(r.session, l, os, { mode: 'upgrade', versions: { [key]: '28.1.0' } }), {
    code: 'recipe_unavailable',
  })
  for (const version of ['27.3.1', '27.2.0']) {
    const r = remote('27.3.1', [version])
    await assert.rejects(preparePlan(r.session, l, os, { mode: 'upgrade', versions: { [key]: version } }), {
      code: 'plan_conflict',
    })
  }
  const plan = await preparePlan(r.session, l, os, { mode: 'upgrade', versions: { [key]: '27.3.2' } })
  assert.equal(plan.changes[0]!.action, 'upgrade')
  assert.equal(r.operations.includes('execute'), false)
})
test('read-only detection filters prereleases and cannot treat a conflicting installed version as no updates', async () => {
  const l = lease(),
    r = remote('26.1.0'),
    checks = await detectUpdates(r.session, l, os)
  assert.equal(checks[0]!.reason, 'version_conflict')
  assert.deepEqual(r.operations, ['detect'])
  const fresh = remote('27.3.1'),
    found = await detectUpdates(fresh.session, l, os)
  assert.deepEqual(
    found[0]!.eligible.map((c) => c.version),
    ['27.3.2'],
  )
  assert.equal(fresh.operations.includes('execute'), false)
})
