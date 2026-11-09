import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PullCredentials } from '../src/pull-credentials.ts'

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pull-credentials-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'pull.json')
  const store = new PullCredentials(file, { encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() })
  const input = { registry: 'registry.example', username: 'pull-only', repositories: ['team/*'], password: 'password-v1', enabled: true, expectedRevision: 0 }
  return { root, file, store, input }
}
test('dedicated pull credentials do not adopt legacy Docker credentials; no plaintext is persisted or returned', async t => {
  const { root, file, store, input } = await fixture(t)
  await writeFile(join(root, 'image-registry.json'), JSON.stringify({ passwordCiphertext: 'legacy-secret' }))
  assert.equal((await store.read()).configured, false)
  const first = await store.save(input)
  assert.equal(first.revision, 1)
  assert.equal(JSON.stringify(first).includes(input.password), false)
  assert.equal((await readFile(file, 'utf8')).includes(input.password), false)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await store.resolve(first.id, 1)).password, input.password)
})
test('empty password preserves, unchanged saves reuse revision, concurrent stale saves cannot overwrite, revocation erases', async t => {
  const { store, input } = await fixture(t)
  await store.save(input)
  const same = await store.save({ ...input, password: '', expectedRevision: 1 })
  assert.equal(same.revision, 1)
  const saves = await Promise.allSettled([
    store.save({ ...input, password: 'password-v2', expectedRevision: 1 }),
    store.save({ ...input, password: 'late-password', expectedRevision: 1 }),
  ])
  assert.equal(saves[0]!.status, 'fulfilled'); assert.equal(saves[1]!.status, 'rejected')
  assert.equal((await store.resolve('platform-pull', 2)).password, 'password-v2')
  await assert.rejects(store.resolve('platform-pull', 1), { code: 'pull_credential_changed' })
  const revoked = await store.save({ expectedRevision: 2, enabled: false })
  assert.equal(revoked.revision, 3); assert.equal(revoked.configured, false)
  await assert.rejects(store.resolve('platform-pull', 3), { code: 'pull_credential_unavailable' })
  await assert.rejects(store.save({ expectedRevision: 3, enabled: true }), { code: 'pull_credential_incomplete' })
})
test('bad scope, newline passwords, corrupt encrypted store and version conflicts fail closed', async t => {
  const { store, input, file } = await fixture(t)
  for (const change of [{ repositories: ['team/../admin'] }, { password: 'secret\nline' }, { registry: 'https://registry.example' }, { expectedRevision: undefined }]) await assert.rejects(store.save({ ...input, ...change }))
  await writeFile(file, '{not-json')
  await assert.rejects(store.read(), { code: 'pull_credentials_unavailable' })
})
