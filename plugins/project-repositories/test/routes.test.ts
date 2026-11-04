import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { apply } from '../src/index.ts'
const sha = 'a'.repeat(40)
const tagSha = 'b'.repeat(40)
let root = ''
let origin = ''
let upstreamOrigin = ''
let previousHome: string | undefined
let cleanup: () => void | Promise<void>
let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
const calls: URL[] = []
let slowStarted: (() => void) | undefined
const upstream = createServer((req, res) => {
  const url = new URL(req.url!, 'http://mock'); calls.push(url)
  if (req.headers.authorization !== `Basic ${Buffer.from('admin:one-secret').toString('base64')}`) { res.writeHead(401); res.end('secret header'); return }
  const send = (data: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)) }
  if (url.pathname === '/~api/projects') {
    const start = Number(url.searchParams.get('offset'))
    send(Array.from({ length: start === 0 ? 100 : 1 }, (_, i) => ({ id: start + i + 1, name: `p${start + i + 1}`, path: `group/p${start + i + 1}`, codeManagement: true }))); return
  }
  if (url.pathname === '/~api/projects/401') { res.writeHead(401); res.end('one-secret: internal detail'); return }
  if (url.pathname === '/~api/projects/1') { send({ id: 1, name: 'p1', path: 'group/p1', codeManagement: true }); return }
  if (url.pathname.endsWith('/clone-url')) { send({ http: `${upstreamOrigin}/group/p1.git` }); return }
  if (url.pathname.endsWith('/branches')) { send(['main', 'feature/name']); return }
  if (url.pathname.endsWith('/tags')) { send(['main']); return }
  if (url.pathname.endsWith('/default-branch')) { res.writeHead(204); res.end(); return }
  if (url.pathname.includes('/branches/')) { send({ commitHash: sha }); return }
  if (url.pathname.includes('/tags/')) { send({ commitHash: tagSha }); return }
  if (url.pathname.endsWith('/files')) {
    const path = url.searchParams.get('file')!
    if (path === 'slow') { slowStarted?.(); return }
    const bytes = path.endsWith('.png') ? Buffer.from([137,80,78,71,13,10,26,10]) : Buffer.from('<html>one-secret<script>alert(1)</script></html>')
    send({ path, size: path === 'partial' ? 500 : bytes.length, base64Content: bytes.toString('base64'), isPartial: path === 'partial' }); return
  }
  res.writeHead(404); res.end('internal details')
})
const server = createServer((req, res) => { void handler(req, res) })
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'ces-repos-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const address = upstream.address(); assert(address && typeof address !== 'string')
  upstreamOrigin = `http://127.0.0.1:${address.port}`
  await writeFile(join(root, 'project-management.json'), JSON.stringify({ internalBaseUrl: upstreamOrigin, externalBaseUrl: 'https://public.example', username: 'admin', passwordCiphertext: 'encrypted', updatedAt: '2026-11-04' }))
  apply({ consoleSession: { read: async cookie => cookie === 'session=yes' ? 'admin' : undefined }, secrets: { encrypt: v => `enc:${v}`, decrypt: () => 'one-secret' },
    webServer: { register: route => { handler = route.handler; return () => {} } }, effect: run => { cleanup = run() } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const local = server.address(); assert(local && typeof local !== 'string'); origin = `http://127.0.0.1:${local.port}`
})
after(async () => {
  await cleanup()
  server.closeAllConnections(); server.close()
  upstream.closeAllConnections(); upstream.close()
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true })
})
const request = (path: string, init: RequestInit = {}) => fetch(`${origin}/console-api/project-management${path}`, { ...init, headers: { cookie: 'session=yes', ...init.headers } })
test('all routes require login and settings never include the saved secret', async () => {
  for (const path of ['/repos/1', '/settings/reveal-password', `/repos/1/raw?sha=${sha}&path=x`]) {
    const response = await fetch(`${origin}/console-api/project-management${path}`)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const response = await request('/settings'); assert.equal((await response.text()).includes('secret'), false)
})
test('projects page beyond 100, nullable default branch and public clone URL', async () => {
  const first = await (await request('/projects')).json()
  assert.equal(first.projects.length, 100); assert.equal(first.nextOffset, 100)
  const second = await (await request('/projects?offset=100')).json()
  assert.equal(second.projects[0].id, 101); assert.equal(second.nextOffset, null)
  const repo = await (await request('/repos/1')).json()
  assert.equal(repo.defaultBranch, null)
  assert.equal(repo.cloneUrl, 'https://public.example/group/p1.git')
  assert.equal(repo.project.webUrl, 'https://public.example/group/p1')
})
test('same-name branch and tag are resolved through separate endpoints', async () => {
  assert.equal((await (await request('/repos/1/resolve?type=branch&name=main')).json()).sha, sha)
  assert.equal((await (await request('/repos/1/resolve?type=tag&name=main')).json()).sha, tagSha)
})
test('upstream errors are classified without returning upstream response text', async () => {
  const response = await request('/repos/401')
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { code: 'upstream_credentials' })
})
test('file requests use pinned SHA and safe attachments, reject traversal and partial downloads', async () => {
  const file = await request(`/repos/1/file?sha=${sha}&path=x.html`)
  assert.equal((await file.json()).content.includes('<script>'), true)
  assert.equal(calls.at(-1)?.searchParams.get('revision'), sha)
  const raw = await request(`/repos/1/raw?sha=${sha}&path=x.html`)
  assert.equal(raw.headers.get('content-type'), 'application/octet-stream')
  assert.match(raw.headers.get('content-disposition')!, /^attachment;/)
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await request(`/repos/1/raw?sha=${sha}&path=partial`)).status, 413)
  assert.equal((await request(`/repos/1/asset?sha=${sha}&path=x.html`)).status, 415)
  assert.equal((await request(`/repos/1/asset?sha=${sha}&path=x.png`)).headers.get('content-type'), 'image/png')
  const count = calls.length
  assert.equal((await request(`/repos/1/file?sha=${sha}&path=../secrets`)).status, 400)
  assert.equal(calls.length, count)
})
test('password reveal requires same-origin JSON POST and limits requests', async () => {
  assert.equal((await request('/settings/reveal-password')).status, 405)
  assert.equal((await request('/settings/reveal-password', { method: 'POST' })).status, 415)
  assert.equal((await request('/settings/reveal-password', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403)
  for (let i = 0; i < 10; i++) {
    const response = await request('/settings/reveal-password', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}' })
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { password: 'one-secret' })
  }
  assert.equal((await request('/settings/reveal-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 429)
})
test('unloading aborts and drains pending upstream work', async () => {
  const started = new Promise<void>(resolve => { slowStarted = resolve })
  const controller = new AbortController()
  const pending = request(`/repos/1/file?sha=${sha}&path=slow`, { signal: controller.signal }).catch(() => undefined)
  await started
  await cleanup()
  controller.abort()
  await pending
})
