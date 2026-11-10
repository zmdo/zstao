import assert from 'node:assert/strict'
import test from 'node:test'
import { OneDev } from '../src/onedev.ts'
import { deliveryAction, listBuilds, parseJobs } from '../src/delivery.ts'
import { tcrTag } from '../src/tcr.ts'
import { authorizeBuild } from '../src/delivery-authorization.ts'

const sha = 'a'.repeat(40)
const build = { id: 7, number: 3, projectId: 2, jobName: 'build', refName: 'refs/heads/main', commitHash: sha, status: 'SUCCESSFUL' }
const spec = 'version: 54\njobs:\n- name: build\n  jobExecutor: build-agent\n'
const one = () => new OneDev({ internalBaseUrl: 'https://one.invalid', externalBaseUrl: 'https://one.invalid', username: 'test', passwordCiphertext: 'encrypted' }, { encrypt: v => v, decrypt: () => 'secret' }, new AbortController().signal)

async function mockFetch(run: (url: URL, init?: RequestInit) => Response | Promise<Response>, task: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = (input, init) => Promise.resolve(run(new URL(String(input)), init))
  try { await task() } finally { globalThis.fetch = original }
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
function discovery(url: URL): Response | undefined {
  if (url.pathname.includes('/projects/ids/')) return json(2)
  if (url.pathname === '/~api/projects/2') return json({ id: 2, name: 'demo', path: 'demo' })
  if (url.pathname.includes('/branches/')) return json({ commitHash: sha })
  if (url.pathname.endsWith('/files')) return json({ path: '.onedev-buildspec.yml', base64Content: Buffer.from(spec).toString('base64'), size: spec.length, isPartial: false })
}

test('job discovery marks imports incomplete and rejects executable YAML tags and aliases abuse', () => {
  assert.equal(parseJobs(spec).jobs[0].executor, 'build-agent')
  assert.equal(parseJobs(spec + 'imports:\n- projectPath: other\n').complete, false)
  assert.throws(() => parseJobs('jobs:\n- !Job {name: build}'), /unsupported_build_spec_syntax/)
  assert.throws(() => parseJobs('jobs: []\njobs: []'), /unsupported_build_spec_syntax/)
})

test('build filters and offset are sent upstream instead of searching global first 100', async () => {
  await mockFetch(url => {
    const found = discovery(url); if (found) return found
    assert.equal(url.searchParams.get('offset'), '100')
    assert.equal(url.searchParams.get('count'), '20')
    assert.match(url.searchParams.get('query')!, /"Commit" is "demo:aaaaaaaa/)
    assert.match(url.searchParams.get('query')!, /"Branch" is "main"/)
    return json([build])
  }, async () => {
    const result = await listBuilds(one(), { action: 'list_builds', project: 'demo', commit: sha, ref: 'main', count: 20, offset: 100 })
    assert.equal(result.builds[0].id, 7)
    assert.equal(result.complete, true)
    assert.equal(result.nextOffset, null)
  })
})

test('run_job refuses changed head and reuses finished matching builds without resubmission', async () => {
  let posts = 0
  await mockFetch((url, init) => {
    if (init?.method === 'POST') posts++
    return discovery(url) ?? (url.pathname.endsWith('/params') ? json([]) : json([build]))
  }, async () => {
    const args = { action: 'run_job', project: 'demo', ref: 'main', commit: sha, job: 'build' }
    await assert.rejects(() => deliveryAction(one(), { ...args, commit: 'b'.repeat(40) }, async () => {}), /ref_commit_changed/)
    const result = await deliveryAction(one(), args, async () => { throw Error('must not ask for reused build') })
    assert.equal('reused' in result && result.reused, true)
    assert.equal(posts, 0)
  })
})

test('submission uses fixed commit and permission before POST; network failure is uncertain', async () => {
  let posts = 0
  let allowed = false
  await mockFetch((url, init) => {
    const found = discovery(url); if (found) return found
    if (init?.method === 'POST') {
      posts++; assert.equal(allowed, true)
      assert.deepEqual(JSON.parse(String(init.body)), { '@type': 'JobRunOnCommit', projectId: 2, commitHash: sha, refName: 'refs/heads/main', jobName: 'build', params: {}, reason: 'Harness project delivery' })
      throw new Error('connection lost after submission')
    }
    return json([])
  }, async () => {
    const args = { action: 'run_job', project: 'demo', ref: 'main', commit: sha, job: 'build' }
    await assert.rejects(() => deliveryAction(one(), args, async () => { throw Error('denied') }), /denied/)
    assert.equal(posts, 0)
    await assert.rejects(() => deliveryAction(one(), args, async () => { allowed = true }), /job_submission_uncertain/)
    assert.equal(posts, 1)
  })
})

test('artifact requires successful build, bounded JSON and matching commit/number', async () => {
  let content: unknown = { build: '3', commit: sha, registry: 'ccr.example.com/team/demo:v3', digest: 'sha256:' + 'c'.repeat(64) }
  let artifactCalls = 0
  await mockFetch(url => {
    if (url.pathname === '/~api/builds/7') return json(build)
    artifactCalls++
    return json(content)
  }, async () => {
    const args = { action: 'get_build_artifact', buildId: 7 }
    const result = await deliveryAction(one(), args, async () => {})
    assert.equal('digestAddress' in result && result.digestAddress, 'ccr.example.com/team/demo@sha256:' + 'c'.repeat(64))
    content = { build: '3', commit: 'b'.repeat(40) }
    await assert.rejects(() => deliveryAction(one(), args, async () => {}), /artifact_build_mismatch/)
    await assert.rejects(() => deliveryAction(one(), { ...args, path: '../secret' }, async () => {}), /invalid_path/)
    assert.equal(artifactCalls, 2)
    content = 'x'.repeat(1024 * 1024)
    await assert.rejects(() => deliveryAction(one(), args, async () => {}), /artifact_too_large/)
  })
})

test('tag lookup reads later pages and does not call an unfinished search not-found', async () => {
  const offsets: number[] = []
  const settings = { registry: 'ccr.example.com', namespace: 'team', region: 'ap-guangzhou', secretId: 'id', secretKey: 'key' }
  await mockFetch((_url, init) => {
    const offset = JSON.parse(String(init?.body)).Offset; offsets.push(offset)
    return json({ Response: { Data: { TagCount: 101, TagInfo: offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ TagName: 'v' + i })) : [{ TagName: 'old', TagId: 'sha256:abc' }] } } })
  }, async () => {
    assert.equal((await tcrTag(settings, 'team/demo', 'old', new AbortController().signal)).name, 'old')
    assert.deepEqual(offsets, [0, 100])
  })
})

test('build authorization requires an actual full-access session or allowed-once approval', async () => {
  const exec = { agent: { session: {} }, signal: new AbortController().signal, callId: 'call' } as Parameters<typeof authorizeBuild>[1]
  await assert.rejects(() => authorizeBuild({}, exec, 'demo', 'build', sha), /approval_unavailable/)
  await authorizeBuild({ get: name => name === 'permissionPresets' ? { current: () => 'danger-full-access' } : name === 'sandboxPolicy' ? { resolve: () => ({ mode: 'danger-full-access' }) } : undefined }, exec, 'demo', 'build', sha)
  await assert.rejects(() => authorizeBuild({ get: name => name === 'approval' ? { request: async () => 'denied' } : undefined }, exec, 'demo', 'build', sha), /approval_denied/)
})
