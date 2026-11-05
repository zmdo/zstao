import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, OneDev, commitSha, imageType, preview, repositoryPath } from '../src/onedev.ts'
import { PREVIEW_BYTES, PREVIEW_LINES } from '../src/shared.ts'
import { browseHash, readBrowseState, readmePath, resolveRepositoryLink } from '../src/browser-state.ts'
import type { BrowseState } from '../src/browser-state.ts'
const sha = 'a'.repeat(40)

test('repository paths reject traversal and preserve encoded-looking Git filenames', () => {
  for (const path of ['/etc/passwd', '../secret', 'src/../../file', 'src/./file', 'src\\file', 'a\0b', 'src//file']) assert.throws(() => repositoryPath(path), ApiError)
  assert.equal(repositoryPath('中文/a #?%.ts'), '中文/a #?%.ts')
  assert.equal(repositoryPath('src/%2e%2e/file'), 'src/%2e%2e/file')
  assert.throws(() => commitSha('main'))
})
test('preview preserves valid UTF-8 at byte boundaries and upstream truncation', () => {
  const bytes = Buffer.from('a'.repeat(PREVIEW_BYTES - 1) + '中文')
  const result = preview({ path: 'x.md', bytes, size: bytes.length, partial: false })
  assert.equal(result.binary, false)
  assert.equal(result.content, 'a'.repeat(PREVIEW_BYTES - 1))
  assert.equal(result.truncated, true)
  assert.equal(result.highlight, false)
  const partial = preview({ path: 'x.md', bytes: Buffer.from('hello'), size: 200, partial: true })
  assert.equal(partial.upstreamPartial, true)
  assert.equal(partial.downloadable, false)
  const splitUtf8 = preview({ path: 'x', bytes: Buffer.from([0x61, 0xe4, 0xb8]), size: 10, partial: true })
  assert.equal(splitUtf8.content, 'a')
  assert.equal(splitUtf8.binary, false)
  assert.equal(preview({ path: 'empty', bytes: Buffer.alloc(0), size: 0, partial: false }).binary, false)
})
test('preview bounds lines and rejects binary or invalid UTF-8', () => {
  const bytes = Buffer.from('a\n'.repeat(PREVIEW_LINES + 1))
  const result = preview({ path: 'x', bytes, size: bytes.length, partial: false })
  assert.equal(result.content.split('\n').length, PREVIEW_LINES)
  assert.equal(result.truncated, true)
  for (const bytes of [Buffer.from([0, 1]), Buffer.from([0xff, 0xfe])]) assert.equal(preview({ path: 'x', bytes, size: bytes.length, partial: false }).binary, true)
  assert.equal(imageType(Buffer.from('<svg onload="alert(1)"/>')), undefined)
  assert.equal(imageType(Buffer.from([137,80,78,71,13,10,26,10])), 'image/png')
})
test('Markdown links resolve against the current directory and stay inside the repository', () => {
  assert.deepEqual(resolveRepositoryLink('docs/guide/README.md', '../../images/a%20b.png'), { kind: 'internal', path: 'images/a b.png', directory: false, anchor: '' })
  assert.deepEqual(resolveRepositoryLink('docs/README.md', '../src/'), { kind: 'internal', path: 'src', directory: true, anchor: '' })
  assert.deepEqual(resolveRepositoryLink('docs/README.md', '#hello'), { kind: 'internal', path: 'docs/README.md', directory: false, anchor: 'hello' })
  for (const link of ['../../secret', 'javascript:alert(1)', 'data:image/svg+xml,x', '..%2f..%2fsecret', 'https://user:pass@example.com/x', '%00x']) assert.equal(resolveRepositoryLink('docs/README.md', link).kind, 'blocked')
  assert.equal(resolveRepositoryLink('README.md', 'https://example.com').kind, 'external')
  assert.equal(readmePath([{ path: 'docs/readme.MD', isFile: true }, { path: 'docs/README', isFile: true }]), 'docs/readme.MD')
})
test('URL state round trips typed refs, frozen SHA and special paths', () => {
  const state: BrowseState = { id: 22, refType: 'tag', refName: 'release/中文', sha, path: 'src/a #?%.ts', kind: 'file', tab: 'code', anchor: 'hello' }
  assert.deepEqual(readBrowseState(browseHash(state)), state)
  assert.equal(readBrowseState('#console=project-code-repositories&repo=2&path=../x'), null)
  assert.equal(readBrowseState('#console=settings&repo=2'), null)
})
test('OneDev uses typed ref endpoints, pinned directory SHA and repeated commit fields', async () => {
  const calls: URL[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(init?.redirect, 'error')
    if (url.pathname.includes('/branches/') || url.pathname.includes('/tags/')) return Response.json({ commitHash: sha })
    if (url.pathname.endsWith('/commits')) return Response.json(Array.from({ length: 101 }, (_, i) => ({ hash: i.toString(16).padStart(40, '0'), subject: 'Commit', author: { name: 'A' }, commitDate: '2026-11-04T00:00:00Z' })))
    return Response.json([{ path: 'src/a #.ts', isFile: true }])
  }
  try {
    const client = new OneDev({ internalBaseUrl: 'https://internal', externalBaseUrl: 'https://public', username: 'u', passwordCiphertext: 'c' }, { encrypt: v => v, decrypt: () => 'secret' }, new AbortController().signal)
    await client.resolve(1, 'branch', 'feature/name')
    await client.resolve(1, 'tag', 'feature/name')
    await client.tree(1, sha, 'src')
    const commits = await client.commits(1, sha)
    assert.equal(calls[0].pathname, '/~api/repositories/1/branches/feature%2Fname')
    assert.equal(calls[1].pathname, '/~api/repositories/1/tags/feature%2Fname')
    assert.equal(calls[2].pathname, `/~api/repositories/1/directories/${sha}/src`)
    assert.equal(calls[3].searchParams.get('query'), `commit(${sha}) order-by-date`)
    assert.deepEqual(calls[3].searchParams.getAll('field'), ['AUTHOR', 'COMMIT_DATE', 'SUBJECT'])
    assert.equal(calls[3].searchParams.has('page'), false)
    assert.equal(commits.commits.length, 100)
    assert.equal(commits.hasMore, true)
  } finally { globalThis.fetch = original }
})
test('upstream response limits cancel oversized bodies before JSON parsing', async () => {
  const original = globalThis.fetch
  let canceled = false
  const client = new OneDev({ internalBaseUrl: 'https://internal', externalBaseUrl: 'https://public', username: 'u', passwordCiphertext: 'c' }, { encrypt: v => v, decrypt: () => 'secret' }, new AbortController().signal)
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel() { canceled = true } }))
    await assert.rejects(client.request('projects'), (error: unknown) => error instanceof ApiError && error.code === 'response_too_large')
    assert.equal(canceled, true)
    globalThis.fetch = async () => Response.json({ unexpected: true })
    await assert.rejects(client.projects(0), (error: unknown) => error instanceof ApiError && error.code === 'invalid_upstream')
  } finally { globalThis.fetch = original }
})
test('default branch is a raw string even with JSON content type, including JSON-looking names', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/default-branch')) return new Response('null', { headers: { 'content-type': 'application/json' } })
    if (url.pathname.endsWith('/branches')) return Response.json(['null'])
    if (url.pathname.endsWith('/tags')) return Response.json([])
    if (url.pathname.endsWith('/clone-url')) return Response.json({ http: 'https://internal/test.git' })
    return Response.json({ id: 1, name: 'test', path: 'test', codeManagement: true })
  }
  try {
    const client = new OneDev({ internalBaseUrl: 'https://internal', externalBaseUrl: 'https://public', username: 'u', passwordCiphertext: 'c' }, { encrypt: v => v, decrypt: () => 'secret' }, new AbortController().signal)
    assert.equal((await client.repository(1)).defaultBranch, 'null')
  } finally { globalThis.fetch = original }
})

test('build list, detail and log frames are parsed', async () => {
  const original = globalThis.fetch
  const build = {
    id: 2, number: 7, projectId: 1, jobName: 'build', refName: 'refs/heads/main', commitHash: sha,
    status: 'SUCCESSFUL', stepExecutions: { 'step-0': { status: 'SUCCESSFUL', duration: 45, startedAt: 1, skipped: false, stepIndex: 1, stepCount: 1 } },
    submitterId: 2, agentId: null, submitDate: '2026-11-04T10:00:00Z', runningDate: '2026-11-04T10:00:01Z', finishDate: '2026-11-04T10:00:02Z',
    pendingDuration: 80, runningDuration: 1000, submitReason: 'Branch update',
  }
  const frame = JSON.stringify({ date: '2026-11-04T10:00:01Z', messages: [{ text: 'hello from build' }, { text: 'second line' }] })
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/streaming/build-logs/2')) return new Response(Buffer.concat([Buffer.from([0, 0, 0, frame.length]), Buffer.from(frame)]), { headers: { 'content-type': 'application/octet-stream' } })
    if (url.pathname.endsWith('/builds/2')) return Response.json(build)
    return Response.json([build])
  }
  try {
    const client = new OneDev({ internalBaseUrl: 'https://internal', externalBaseUrl: 'https://public', username: 'u', passwordCiphertext: 'c' }, { encrypt: v => v, decrypt: () => 'secret' }, new AbortController().signal)
    const list = await client.builds(0, 20)
    assert.equal(list[0].jobName, 'build'); assert.equal(list[0].steps[0].name, 'step-0'); assert.equal(list[0].runningDuration, 1000)
    const detail = await client.build(2)
    assert.equal(detail.number, 7); assert.equal(detail.status, 'SUCCESSFUL'); assert.equal(detail.steps[0].duration, 45)
    assert.equal(await client.buildLogs(2), 'hello from build\nsecond line')
  } finally { globalThis.fetch = original }
})
