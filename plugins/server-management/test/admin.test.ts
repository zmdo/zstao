import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AdminRuntime } from '../src/host/admin/runtime.ts'
import { generateKey, publicKey } from '../src/host/admin/keys.ts'
import { AUTHORIZED_KEYS_SCRIPT } from '../src/host/admin/rotation.ts'
import { auditFilter } from '../src/host/admin/retention.ts'

test('audit filters reject invalid dates, oversized pages and mutation fields', () => {
  assert.throws(() => auditFilter({ from: 'bad' }), /audit_invalid/)
  assert.throws(() => auditFilter({ page_size: 101 }), /audit_invalid/)
  assert.throws(() => auditFilter({ delete: true }), /invalid_request/)
})

test('unloading admin runtime aborts and awaits in-flight work before returning', async () => {
  const runtime = new AdminRuntime({} as never)
  let finish!: () => void,
    aborted = false,
    closed = false
  const work = runtime.run(async (signal) => {
    signal.addEventListener('abort', () => {
      aborted = true
    })
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return 'persisted'
  })
  const disposal = runtime.close().then(() => {
    closed = true
  })
  assert.equal(aborted, true)
  await Promise.resolve()
  assert.equal(closed, false)
  await assert.rejects(
    runtime.run(async () => {}),
    /cancelled/,
  )
  finish()
  assert.equal(await work, 'persisted')
  await disposal
  assert.equal(closed, true)
})

test('remote key edits preserve options and unrelated entries, are idempotent and reject ambiguity', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'smp-key-script-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, '.ssh'))
  const file = join(home, '.ssh', 'authorized_keys')
  const old = publicKey(generateKey().private),
    next = publicKey(generateKey().private),
    unrelated = publicKey(generateKey().private)
  const options = 'restrict,command="echo restricted command"'
  const initial = `# retain this comment\n${options} ${old} old\n${unrelated} other\n`
  await writeFile(file, initial, { mode: 0o600 })
  const run = (mode: string) =>
    execFileSync('python3', ['-c', AUTHORIZED_KEYS_SCRIPT], {
      env: { ...process.env, HOME: home },
      input: JSON.stringify({ mode, old, new: next, key_id: 'test' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  assert.equal(run('add').toString().trim(), 'ok')
  const deployed = await readFile(file, 'utf8')
  assert.ok(deployed.includes(next))
  assert.ok(deployed.includes(`${options} ${next}`))
  run('add')
  assert.equal(await readFile(file, 'utf8'), deployed)
  run('remove')
  run('remove')
  const final = await readFile(file, 'utf8')
  assert.ok(!final.includes(old))
  assert.ok(final.includes(unrelated))
  assert.ok(final.startsWith('# retain'))
  await writeFile(file, `${initial}${old} duplicate\n`)
  await assert.rejects(async () => run('add'))
  assert.equal(await readFile(file, 'utf8'), `${initial}${old} duplicate\n`)
})
