import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OneDev } from '../src/onedev.ts'
import { BOOTSTRAP_DEFAULTS, bootstrapSettings, createManagedProject, resolveProject, projectContext, buildEnvironment } from '../src/bootstrap.ts'
import { ensurePrivateRepository } from '../src/tcr.ts'

const settings = { ...BOOTSTRAP_DEFAULTS, gitSshBaseUrl: 'ssh://git@private.example:2222' }
const project = { id: 20, name: 'todo', path: 'apps/todo', codeManagement: true }
const client = () => new OneDev({ ...settings, internalBaseUrl: 'https://api.example', externalBaseUrl: 'https://web.example', username: 'u', passwordCiphertext: 'encrypted' }, { encrypt: v => v, decrypt: () => 'secret' }, new AbortController().signal)
const json = (v: unknown, status = 200) => Response.json(v, { status })
async function mock(run: (url: URL, init?: RequestInit) => Response | Promise<Response>, task: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = (url, init) => Promise.resolve(run(new URL(String(url)), init))
  try { await task() } finally { globalThis.fetch = original }
}

test('SSH connection comes from one configured source, preserves user/port, and never uses web host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bootstrap-'))
  await mkdir(join(root, 'keys'))
  await writeFile(join(root, 'keys/cesai'), 'test fixture')
  await writeFile(join(root, 'keys/known_hosts'), 'test fixture')
  try {
    await mock(() => json({ http: 'https://api.example/apps/todo.git', ssh: 'ssh://git@upstream.example:3333/apps/todo.git' }), async () => {
      const one = client()
      const p = one.project(project)
      const c = await projectContext(one, p, settings, root, { registry: 'registry.example', namespace: 'team' })
      assert.equal(c.git.sshCloneUrl, 'ssh://git@private.example:2222/apps/todo.git')
      assert.equal(c.git.cloneUrl, 'https://web.example/apps/todo.git')
      assert.equal(c.git.configured, true)
      assert.match(c.git.sshCommand, /StrictHostKeyChecking=yes/)
      assert.equal(c.delivery.imageRepository, 'registry.example/team/ces-project-20')
      assert.equal(JSON.stringify(c).includes('test fixture'), false)
      const upstream = new OneDev({ internalBaseUrl: 'https://api.example', externalBaseUrl: 'https://web.example', username: 'u', passwordCiphertext: 'x' }, { encrypt: v => v, decrypt: () => 'secret' }, new AbortController().signal)
      assert.equal((await upstream.cloneUrls(20, 'apps/todo')).ssh, 'ssh://git@upstream.example:3333/apps/todo.git')
    })
  } finally { await rm(root, { recursive: true, force: true }) }
  for (const url of ['https://host', 'ssh://git:secret@host', 'ssh://git@host/path', 'ssh://git@host?x=y']) assert.throws(() => bootstrapSettings({ gitSshBaseUrl: url }), /invalid_git_ssh_url/)
})

test('managed project creation repairs failed authorization without creating another repository', async () => {
  let exists = false; let grants = 0; let creates = 0; let authorized = 0
  await mock((url, init) => {
    const path = decodeURIComponent(url.pathname.replace('/~api/', ''))
    if (path === 'projects/ids/apps/todo') return exists ? json(20) : json({}, 404)
    if (path === 'projects/ids/todo') return json({}, 404)
    if (path === 'projects/ids/apps') return json(10)
    if (path === 'projects/10') return json({ id: 10, name: 'apps', path: 'apps' })
    if (path === 'projects/20') return json(project)
    if (path === 'projects') {
      assert.equal(authorized > 0, true)
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body));assert.equal(body.parentId, 10);assert.equal(body.name, 'todo')
      exists = true; creates++;return json(20)
    }
    if (path === 'users') return json([{ id: 2, name: 'cesai' }])
    if (path === 'roles') return json([{ id: 2, name: 'Code Writer' }])
    if (path === 'projects/20/user-authorizations') return json(grants > 1 ? [{ userId: 2, roleId: 2 }] : [])
    if (path === 'user-authorizations') { grants++;return grants === 1 ? json({}, 403) : json(8) }
    throw Error('Unexpected URL ' + path)
  }, async () => {
    const authorize = async () => { authorized++ }
    const first = await createManagedProject(client(), 'todo', 'Todo', settings, authorize)
    assert.equal(first.created, true); assert.equal(first.access.ready, false); assert.equal(first.project.path, 'apps/todo')
    const second = await createManagedProject(client(), 'apps/todo', 'Todo', settings, authorize)
    assert.equal(second.created, false);assert.equal(second.access.ready, true)
    const third = await createManagedProject(client(), 'todo', 'Todo', settings, authorize)
    assert.equal(third.access.changed, false);assert.equal(creates, 1);assert.equal(grants, 2)
    assert.equal((await resolveProject(client(), 'todo', settings))?.path, 'apps/todo')
  })
})

test('unmanaged repositories keep access and denied creation performs no writes', async () => {
  let writes = 0
  await mock((url, init) => {
    if (init?.method === 'POST') writes++
    const path = decodeURIComponent(url.pathname)
    if (path.endsWith('/ids/legacy')) return json(1)
    if (path.endsWith('/projects/1')) return json({ id: 1, name: 'legacy', path: 'legacy', codeManagement: true })
    return json({}, 404)
  }, async () => {
    const result = await createManagedProject(client(), 'legacy', '', settings, async () => { throw Error('must not authorize unrelated access') })
    assert.equal(result.managed, false);assert.equal(result.access.ready, null)
    await assert.rejects(createManagedProject(client(), 'new', '', settings, async () => { throw Error('denied') }), /denied/)
    await assert.rejects(createManagedProject(client(), 'outside/new', '', settings, async () => {}), /project_outside_managed_space/)
    await assert.rejects(createManagedProject(client(), 'apps/../other', '', settings, async () => {}), /invalid_project_name/)
    assert.equal(writes, 0)
  })
})

test('private image preparation reconciles a lost create response and rejects a public name collision', async () => {
  let exists = false;let creates = 0;let publicRepo = false
  const tcr = { registry: 'registry.example', namespace: 'team', region: 'ap-beijing', secretId: 'id', secretKey: 'secret' }
  await mock((_url, init) => {
    const action = new Headers(init?.headers).get('x-tc-action')
    const body = JSON.parse(String(init?.body));assert.equal(body.RepoName, 'team/ces-project-20')
    if (action === 'CreateRepositoryPersonal') { creates++;assert.equal(body.Public, 0);exists = true;throw Error('lost response') }
    if (!exists) return json({ Response: { Error: { Code: 'ResourceNotFound.ErrNoRepo' } } })
    return json({ Response: { Data: { RepoName: body.RepoName, Public: publicRepo ? 1 : 0 } } })
  }, async () => {
    const signal = new AbortController().signal
    assert.equal((await ensurePrivateRepository(tcr, 20, signal)).repository, 'team/ces-project-20')
    assert.equal((await ensurePrivateRepository(tcr, 20, signal)).created, false)
    assert.equal(creates, 1)
    publicRepo = true
    await assert.rejects(ensurePrivateRepository(tcr, 20, signal), /delivery_repository_must_be_private/)
    assert.equal(creates, 1)
  })
})

test('build readiness checks the selected executor and finds an online unpaused agent beyond the first page', async () => {
  await mock(url => {
    if (url.pathname.endsWith('/job-executors')) return json([{ '@type': 'RemoteShellExecutor', name: settings.buildExecutor, enabled: true, jobMatch: '"Project" is "apps/**" and "Job" is "build"', agentQuery: '"Name" is "builder"' }])
    assert.equal(url.searchParams.get('query'), '"Name" is "builder"')
    return json(url.searchParams.get('offset') === '0' ? Array.from({ length: 100 }, (_, id) => ({ id, online: true, paused: true })) : [{ id: 101, name: 'builder', online: true, paused: false }])
  }, async () => {
    const result = await buildEnvironment(client(), settings)
    assert.deepEqual(result.agents, [{ id: 101, name: 'builder' }])
  })
})
