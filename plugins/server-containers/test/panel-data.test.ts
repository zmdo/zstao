import assert from 'node:assert/strict'
import test from 'node:test'
import { parseContainers } from '../src/model.ts'
import { pollSnapshots } from '../src/poll.ts'

test('container records reject invalid IDs, duplicate IDs and malformed fields', () => {
  const row = { ID: 'abc', Names: 'web', Image: 'nginx', Status: 'running', Ports: '' }
  assert.equal(parseContainers(JSON.stringify(row)).containers[0]?.name, 'web')
  assert.deepEqual(parseContainers('\n'), { containers: [] })
  for (const bad of [{ ...row, ID: '' }, { ...row, Ports: null }, { ...row, Image: {} }])
    assert.throws(() => parseContainers(JSON.stringify(bad)))
  assert.throws(() => parseContainers(`${JSON.stringify(row)}\n${JSON.stringify(row)}`))
})

test('polling publishes refreshed snapshots, reports failure and recovers while staying mounted', async () => {
  const snapshots: number[] = [], errors: unknown[] = []
  let calls = 0
  let finished!: () => void
  const done = new Promise<void>((resolve) => { finished = resolve })
  const stop = pollSnapshots({
    async read() { calls++; if (calls === 2) throw new Error('offline'); return calls },
    publish(value) { snapshots.push(value); if (value === 3) finished() },
    failed(error) { errors.push(error) }, intervalMs: 1,
  })
  try { await done } finally { stop() }
  assert.deepEqual(snapshots, [1, 3])
  assert.equal(errors.length, 1)
})

test('unmount aborts the in-flight request and suppresses its late result', async () => {
  let resolve!: (value: number) => void
  let signal: AbortSignal | undefined
  let published = false
  const stop = pollSnapshots({
    read(value) { signal = value; return new Promise<number>((done) => { resolve = done }) },
    publish() { published = true }, failed() { published = true }, intervalMs: 1,
  })
  stop()
  resolve(1)
  await new Promise((done) => setImmediate(done))
  assert.equal(signal?.aborted, true)
  assert.equal(published, false)
})

test('the container plugin refuses a database without its required migrations', async () => {
  const { requireContainerSchema } = await import('../src/persistence/containers.ts')
  const db = { async query<T>() { return { rows: [] as T[] } } }
  await assert.rejects(requireContainerSchema(db), /0021_container_plugin_observations/)
  await requireContainerSchema({ async query<T>() { return { rows: [
    { id: '0019_server_extension_observations.sql' }, { id: '0021_container_plugin_observations.sql' },
  ] as T[] } } })
})
