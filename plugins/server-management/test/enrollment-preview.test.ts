import assert from 'node:assert/strict'
import test from 'node:test'
import type { ServerTypeView } from '../src/shared/definitions.ts'
import { ServerError } from '../src/shared/errors.ts'
import { declaredOsFromDetected } from '../src/shared/operating-systems.ts'
import {
  EnrollmentPreview,
  type IdentificationResult,
} from '../src/client/servers/form/enrollment-preview.ts'

const detected = { family: 'builtin/ubuntu', version: '24.04', architecture: 'x86_64' }
const os = declaredOsFromDetected(detected)
const types: ServerTypeView[] = ['vacant', 'general'].map((key) => ({
  key, name_i18n: { zh: key, en: key }, supportedOs: { kind: 'all' },
  software: key === 'vacant' ? [] : [{
    id: 'docker', software_key: 'builtin/docker', supportedOs: [], name: 'Docker', summary: '',
    name_i18n: { zh: 'Docker', en: 'Docker' }, summary_i18n: { zh: '', en: '' },
    requires: [], recipe: 'fixture', revision: '1',
  }],
}))
const authentication = { host: '127.0.0.1', ssh_port: 22, ssh_user: 'fixture', auth_method: 'password', secret: 'fixture' }
const selection = (typeKey: string, groupId = '') => ({ groupId, typeKey, os, types })

function result(type: string): IdentificationResult {
  return {
    declared_os: os, detected_os: detected, type_key: type,
    required_software: [...types.find((item) => item.key === type)!.software],
    software_status: type === 'vacant' ? {} : { docker: { state: 'installed', version: '27.3.1' } },
    software_available: true, detected_at: '2026-10-19T08:00:00.000Z',
  }
}

function setup(t: test.TestContext) {
  let now = 1000, tests = 0
  const identifications: { type: string; group: string | null; signal: AbortSignal }[] = []
  let identify = async (type: string): Promise<IdentificationResult> => result(type)
  const preview = new EnrollmentPreview(async <T>(path: string, init?: RequestInit): Promise<T> => {
    const body = JSON.parse(String(init?.body))
    if (path.endsWith('/test-connection')) {
      tests++
      return { fingerprint: 'SHA256:fixture', connection_token: `receipt-${tests}`, expires_at: now + 600_000 } as T
    }
    identifications.push({ type: body.type_key, group: body.group_id, signal: init!.signal! })
    return await identify(body.type_key) as T
  }, () => now)
  t.after(() => preview.clear())
  return {
    preview, identifications,
    get tests() { return tests },
    advance(ms: number) { now += ms },
    identifyWith(work: typeof identify) { identify = work },
  }
}

test('switching types tests once, detects each type and reuses the corresponding observations', async (t) => {
  const fixture = setup(t), { preview, identifications } = fixture
  const vacant = await preview.identify(1, authentication, selection('vacant'))
  const general = await preview.identify(1, authentication, selection('general'))
  assert.deepEqual(vacant.identification.software_status, {})
  assert.equal(general.identification.software_status.docker?.version, '27.3.1')
  assert.equal((await preview.identify(1, authentication, selection('vacant'))).cached, true)
  assert.equal((await preview.identify(1, authentication, selection('general'))).cached, true)
  assert.equal(identifications.length, 2)
  assert.equal(fixture.tests, 1)
})

test('concurrent type checks share a connection test and duplicate checks share detection', async (t) => {
  const fixture = setup(t)
  const responses = await Promise.all(['general', 'general', 'vacant'].map((type) =>
    fixture.preview.identify(1, authentication, selection(type)),
  ))
  assert.equal(fixture.tests, 1)
  assert.equal(fixture.identifications.length, 2)
  assert.equal(responses[0]!.identification, responses[1]!.identification)
})

test('manual identification refreshes one type while manual connection testing clears all observations', async (t) => {
  const fixture = setup(t), preview = fixture.preview
  await preview.identify(1, authentication, selection('general'))
  await preview.identify(1, authentication, selection('vacant'))
  const fresh = await preview.identify(1, authentication, selection('general'), true)
  assert.equal(fresh.cached, false)
  assert.equal(fixture.identifications.length, 3)
  assert.ok(preview.cached(1, selection('vacant')))
  await preview.test(1, authentication, true)
  assert.equal(preview.cached(1, selection('general')), undefined)
  assert.equal(preview.cached(1, selection('vacant')), undefined)
  assert.equal(fixture.tests, 2)
})

test('expired receipts also expire observations and require another connection test', async (t) => {
  const fixture = setup(t), preview = fixture.preview
  await preview.identify(1, authentication, selection('general'))
  fixture.advance(600_000)
  assert.equal(preview.cached(1, selection('general')), undefined)
  assert.equal((await preview.identify(1, authentication, selection('general'))).cached, false)
  assert.equal(fixture.tests, 2)
})

test('group, OS and software definition changes isolate cached results, while OS labels do not', async (t) => {
  const fixture = setup(t), preview = fixture.preview
  const original = selection('general', 'first')
  await preview.identify(1, authentication, original)
  assert.equal(preview.cached(1, selection('general', 'second')), undefined)
  assert.equal(preview.cached(1, { ...original, os: { kind: 'custom', text: 'Other OS' } }), undefined)
  if (os.kind !== 'catalog') throw new Error('Expected catalog OS')
  assert.ok(preview.cached(1, { ...original, os: { ...os, name: 'Different label' } }))
  const changed = types.map((type) => ({ ...type, software: type.software.map((software) => ({ ...software, revision: '2' })) }))
  assert.equal(preview.cached(1, { ...original, types: changed }), undefined)
  await preview.identify(1, authentication, { ...original, types: changed })
  assert.equal(fixture.identifications.length, 2)
})

test('credential changes abort pending requests and late results cannot repopulate the cache', async (t) => {
  const fixture = setup(t), preview = fixture.preview
  const started = Promise.withResolvers<void>(), delayed = Promise.withResolvers<IdentificationResult>()
  fixture.identifyWith(async () => { started.resolve(); return delayed.promise })
  const checking = preview.identify(1, authentication, selection('general'))
  await started.promise
  preview.sync(2)
  assert.equal(fixture.identifications[0]!.signal.aborted, true)
  delayed.resolve(result('general'))
  await assert.rejects(checking, { code: 'connection_test_required' })
  assert.equal(preview.cached(2, selection('general')), undefined)
  fixture.identifyWith(async (type) => result(type))
  await preview.identify(2, { ...authentication, ssh_port: 2222 }, selection('general'))
  assert.equal(fixture.tests, 2)
})

test('late results for a previous type stay in that type cache without replacing another type', async (t) => {
  const fixture = setup(t), preview = fixture.preview
  const started = Promise.withResolvers<void>(), delayed = Promise.withResolvers<IdentificationResult>()
  fixture.identifyWith(async (type) => {
    if (type === 'general') { started.resolve(); return delayed.promise }
    return result(type)
  })
  const checking = preview.identify(1, authentication, selection('general'))
  await started.promise
  await preview.identify(1, authentication, selection('vacant'))
  assert.deepEqual(preview.cached(1, selection('vacant'))?.software_status, {})
  delayed.resolve(result('general'))
  await checking
  assert.equal(preview.cached(1, selection('general'))?.software_status.docker?.version, '27.3.1')
  assert.deepEqual(preview.cached(1, selection('vacant'))?.software_status, {})
})

test('failed detection is not cached and an SSH failure invalidates the connection receipt', async (t) => {
  const fixture = setup(t), preview = fixture.preview
  fixture.identifyWith(async () => { throw new ServerError('os_probe_failed') })
  await assert.rejects(preview.identify(1, authentication, selection('general')), { code: 'os_probe_failed' })
  assert.equal(preview.cached(1, selection('general')), undefined)
  fixture.identifyWith(async (type) => result(type))
  await preview.identify(1, authentication, selection('general'))
  assert.equal(fixture.tests, 1)
  fixture.identifyWith(async () => { throw new ServerError('ssh_auth_failed') })
  await assert.rejects(preview.identify(1, authentication, selection('vacant')), { code: 'ssh_auth_failed' })
  assert.equal(preview.cached(1, selection('general')), undefined)
  fixture.identifyWith(async (type) => result(type))
  await preview.identify(1, authentication, selection('general'))
  assert.equal(fixture.tests, 2)
})

test('OS corrections and fallback types are cached under the actual result rather than the requested type', async (t) => {
  const fixture = setup(t), preview = fixture.preview
  fixture.identifyWith(async () => result('vacant'))
  await preview.identify(1, authentication, { ...selection('general'), os: { kind: 'custom', text: 'Wrong OS' } })
  assert.equal(preview.cached(1, selection('general')), undefined)
  assert.ok(preview.cached(1, selection('vacant')))
  assert.equal((await preview.identify(1, authentication, selection('vacant'))).cached, true)
  assert.equal(fixture.identifications.length, 1)
})
