import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { type TestContext } from 'node:test'

const owner = '@smp/console-container-runtime'
const recipe = fileURLToPath(new URL('../scripts/recipe.sh', import.meta.url))
const fixture = new URL('./fixtures/recipe-env.py', import.meta.url)
const pkg = (name = 'docker.io', version = '29.1.3-1') => ({
  manager: 'apt', name, version, architecture: 'amd64', source: `pool/${name}.deb`, checksum: 'a'.repeat(64),
})

async function setup(t: TestContext, options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'smp-container-recipe-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await copyFile(fixture, join(directory, 'sitecustomize.py'))
  const statePath = join(directory, 'state.json')
  const initial = {
    uid: 1000, users: { ubuntu: { uid: 1000, gid: 1001 }, root: { uid: 0, gid: 0 }, admin2: { uid: 1002, gid: 1002 } },
    groupExists: false, members: [], installed: {}, commands: [], ...options,
  }
  await writeFile(statePath, JSON.stringify(initial))
  const state = async () => JSON.parse(await readFile(statePath, 'utf8'))
  const update = async (patch: Record<string, unknown>) => writeFile(statePath, JSON.stringify({ ...await state(), ...patch }))
  function invoke(operation: string, fields: Record<string, unknown> = {}, software = 'docker-engine') {
    const request = { contractVersion: 2, operation, software: `${owner}/${software}`, recipe: `${owner}/${software}-apt`, recipeRevision: 'test', ...fields }
    const result = spawnSync('sh', [recipe], {
      input: JSON.stringify(request), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PYTHONPATH: directory, SMP_RECIPE_TEST_STATE: statePath },
    })
    assert.equal(result.status, 0, result.stderr || String(result.error))
    return JSON.parse(result.stdout)
  }
  function plan(software = 'docker-engine') {
    const target = software === 'docker-engine' ? pkg() : pkg('docker-compose-v2', '2.40.3-1')
    return invoke('resolve', {
      installed: { state: 'missing' },
      target: { version: target.version.split('-')[0], targetIdentity: `${target.name}=${target.version}`, packages: [target], channel: 'stable' },
    }, software).change
  }
  return { state, update, invoke, plan }
}

test('preflight freezes the SSH account; root installation adds only that account and verifies it', async (t) => {
  const f = await setup(t)
  const change = f.plan()
  assert.deepEqual(change.payload.dockerUser, { name: 'ubuntu', uid: 1000 })
  assert.ok(change.effects.some((e: any) => e.kind === 'configuration' && e.description.en.includes('ubuntu')))
  await f.update({ uid: 0 })
  const result = f.invoke('execute', { change })
  assert.equal(result.state, 'completed')
  assert.deepEqual((await f.state()).members, ['ubuntu'])
  assert.ok(result.changes.some((c: any) => c.kind === 'group-membership' && c.user === 'ubuntu'))
  assert.equal(f.invoke('verify', { change }).healthy, true)
  const commands = (await f.state()).commands
  assert.ok(commands.findIndex((a: string[]) => a.includes('--yes')) < commands.findIndex((a: string[]) => a[0] === 'usermod'))
})

test('usermod failure reports a failed mutation and preserves the installed package fact', async (t) => {
  const f = await setup(t, { groupFailure: true })
  const change = f.plan()
  await f.update({ uid: 0 })
  const result = f.invoke('execute', { change })
  assert.equal(result.state, 'failed')
  assert.match(result.detail, /ubuntu.*cannot lock \/etc\/group/)
  assert.equal(result.changes[0].name, 'docker.io')
  assert.equal((await f.state()).installed['docker.io'], '29.1.3-1')
  assert.equal(f.invoke('verify', { change }).healthy, false)
})

test('successful usermod exit without membership does not report success', async (t) => {
  const f = await setup(t, { groupNoop: true })
  const change = f.plan()
  await f.update({ uid: 0 })
  const result = f.invoke('execute', { change })
  assert.equal(result.state, 'failed')
  assert.match(result.detail, /membership was not applied/)
})

test('account identity drift fails before any package or group mutation', async (t) => {
  const f = await setup(t)
  const change = f.plan()
  await f.update({ uid: 0, users: { ubuntu: { uid: 2000, gid: 1001 }, root: { uid: 0, gid: 0 } } })
  const result = f.invoke('execute', { change })
  assert.equal(result.state, 'failed')
  assert.match(result.detail, /user changed after preflight/)
  assert.equal((await f.state()).commands.some((a: string[]) => a.includes('--yes') || a[0] === 'usermod'), false)
})

test('root login needs no docker group membership', async (t) => {
  const f = await setup(t, { uid: 0 })
  const change = f.plan()
  assert.deepEqual(change.payload.dockerUser, { name: 'root', uid: 0 })
  assert.equal(change.effects.some((e: any) => e.kind === 'configuration'), false)
  assert.equal(f.invoke('execute', { change }).state, 'completed')
  assert.equal(f.invoke('verify', { change }).healthy, true)
  assert.equal((await f.state()).commands.some((a: string[]) => a[0] === 'usermod'), false)
})

test('primary docker group membership is accepted without redundant usermod', async (t) => {
  const f = await setup(t, { users: { ubuntu: { uid: 1000, gid: 988 }, root: { uid: 0, gid: 0 } } })
  const change = f.plan()
  await f.update({ uid: 0 })
  assert.equal(f.invoke('execute', { change }).state, 'completed')
  assert.equal(f.invoke('verify', { change }).healthy, true)
  assert.equal((await f.state()).commands.some((a: string[]) => a[0] === 'usermod'), false)
})

test('Compose installation does not change user groups', async (t) => {
  const f = await setup(t)
  const change = f.plan('docker-compose')
  assert.equal(change.payload.dockerUser, undefined)
  await f.update({ uid: 0 })
  assert.equal(f.invoke('execute', { change }, 'docker-compose').state, 'completed')
  assert.equal(f.invoke('verify', { change }, 'docker-compose').healthy, true)
  assert.equal((await f.state()).commands.some((a: string[]) => a[0] === 'usermod'), false)
})

test('an already installed target can finish its group change without reinstalling; a repeat is a no-op', async (t) => {
  const f = await setup(t)
  const change = f.plan()
  await f.update({ uid: 0, installed: { 'docker.io': '29.1.3-1' }, groupExists: true })
  assert.equal(f.invoke('verify', { change }).code, 'docker_group_membership_missing')
  assert.equal(f.invoke('execute', { change }).state, 'completed')
  assert.deepEqual(f.invoke('execute', { change }).changes, [])
  assert.equal((await f.state()).commands.some((a: string[]) => a.includes('--yes')), false)
  assert.equal((await f.state()).commands.filter((a: string[]) => a[0] === 'usermod').length, 1)
  await f.update({ members: [] })
  assert.equal(f.invoke('verify', { change }).healthy, false)
})

test('a plan without the frozen account is rejected instead of guessing administrator users', async (t) => {
  const f = await setup(t)
  const change = f.plan()
  delete change.payload.dockerUser
  await f.update({ uid: 0 })
  const result = f.invoke('execute', { change })
  assert.equal(result.state, 'failed')
  assert.match(result.detail, /run preflight again/)
  assert.equal((await f.state()).commands.some((a: string[]) => a.includes('--yes') || a[0] === 'usermod'), false)
})

test('a failed access repair does not claim an unchanged package was installed by this execution', async (t) => {
  const f = await setup(t)
  const change = f.plan()
  await f.update({ uid: 0, installed: { 'docker.io': '29.1.3-1' }, groupExists: true, groupFailure: true })
  const result = f.invoke('execute', { change })
  assert.equal(result.state, 'failed')
  assert.deepEqual(result.changes, [])
  assert.equal((await f.state()).commands.some((a: string[]) => a.includes('--yes')), false)
})
