import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compileBatch, executeBatch } from '../src/host/batch.ts'

const settings = {
  role: 'default' as const,
  bucket: 'demo-1250000000',
  region: 'ap-beijing',
  secretId: 'id',
  secretKey: 'key',
  basePrefix: '',
  maxUploadBytes: 1024 * 1024,
  maxPreviewBytes: 1024 * 1024,
  enabled: true,
}

const etagOf = (body: Buffer): string => createHash('md5').update(body).digest('hex')

interface FakeObject {
  body: Buffer
  etag: string
}

function fakeCos(initial: Record<string, string> = {}) {
  const store = new Map<string, FakeObject>()
  const calls: string[] = []
  for (const [key, value] of Object.entries(initial)) {
    const body = Buffer.from(value)
    store.set(key, { body, etag: etagOf(body) })
  }
  const client = {
    headObject(params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) {
      const item = store.get(String(params.Key))
      if (item === undefined) return callback({ statusCode: 404, code: 'NoSuchKey' }, undefined)
      callback(null, { headers: { 'content-length': String(item.body.length), etag: item.etag } })
    },
    getBucket(params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) {
      const prefix = String(params.Prefix ?? '')
      const marker = String(params.Marker ?? '')
      const keys = [...store.keys()].filter((key) => key.startsWith(prefix) && key > marker).sort()
      const page = keys.slice(0, Number(params.MaxKeys ?? 1000))
      callback(null, {
        Contents: page.map((key) => ({ Key: key, Size: String(store.get(key)?.body.length ?? 0) })),
        IsTruncated: keys.length > page.length ? 'true' : 'false',
        NextMarker: page[page.length - 1],
      })
    },
    putObject(params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) {
      const chunks: Buffer[] = []
      const stream = params.Body as NodeJS.ReadableStream
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      stream.on('error', (error: Error) => callback(error, undefined))
      stream.on('end', () => {
        const body = Buffer.concat(chunks)
        store.set(String(params.Key), { body, etag: etagOf(body) })
        calls.push(`put:${String(params.Key)}`)
        callback(null, {})
      })
    },
    putObjectCopy(params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) {
      const source = decodeURIComponent(String(params.CopySource ?? '').split('.myqcloud.com/')[1] ?? '')
      const item = store.get(source)
      if (item === undefined) return callback({ statusCode: 404, code: 'NoSuchKey' }, undefined)
      store.set(String(params.Key), { body: item.body, etag: item.etag })
      calls.push(`copy:${String(params.Key)}`)
      callback(null, {})
    },
    deleteObject(params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) {
      const key = String(params.Key)
      if (!store.has(key)) return callback({ statusCode: 404, code: 'NoSuchKey' }, undefined)
      store.delete(key)
      calls.push(`delete:${key}`)
      callback(null, {})
    },
    getObject(_params: Record<string, unknown>, _callback: (error: unknown, data: unknown) => void) {},
    getObjectUrl() {},
  }
  return { client, store, calls }
}

test('compile expands a recursive prefix and maps target keys', async () => {
  const fake = fakeCos({ 'old/a.txt': 'A', 'old/sub/b.txt': 'BB', 'keep.txt': 'K' })
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'move', from: 'old/', to: 'new/', recursive: true }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(
    result.plan.items.map((item) => [item.from, item.to]),
    [
      ['old/a.txt', 'new/a.txt'],
      ['old/sub/b.txt', 'new/sub/b.txt'],
    ],
  )
  assert.equal(result.plan.summary.move, 2)
  assert.equal(result.plan.summary.items, 2)
})

test('compile rejects a destination inside the source prefix', async () => {
  const fake = fakeCos({ 'a/x.txt': 'X' })
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'move', from: 'a/', to: 'a/b/', recursive: true }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.problems.join('\n'), /目标前缀不能位于源前缀内/)
})

test('compile detects destination conflicts', async () => {
  const fake = fakeCos({ 'src.txt': 'SRC', 'dst.txt': 'DST' })
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'move', from: 'src.txt', to: 'dst.txt' }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.plan.summary.conflicts, 1)
})

test('a skipped conflict leaves both objects untouched', async () => {
  const fake = fakeCos({ 'src.txt': 'SRC', 'dst.txt': 'DST' })
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'move', from: 'src.txt', to: 'dst.txt' }],
    { onConflict: 'skip', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  const outcome = await executeBatch(settings, fake.client as never, result.plan)
  assert.equal(outcome.items[0]?.status, 'skipped_conflict')
  assert.equal(fake.store.get('src.txt')?.body.toString(), 'SRC')
  assert.equal(fake.store.get('dst.txt')?.body.toString(), 'DST')
})

test('move copies, verifies and deletes the source', async () => {
  const fake = fakeCos({ 'src.txt': 'SRC' })
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'move', from: 'src.txt', to: 'dst.txt' }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  const outcome = await executeBatch(settings, fake.client as never, result.plan)
  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.items[0]?.status, 'ok')
  assert.equal(outcome.items[0]?.size, 3)
  assert.equal(fake.store.has('src.txt'), false)
  assert.equal(fake.store.get('dst.txt')?.body.toString(), 'SRC')
  assert.deepEqual(fake.calls, ['copy:dst.txt', 'delete:src.txt'])
})

test('a move keeps the source when deleting it fails', async () => {
  const fake = fakeCos({ 'src.txt': 'SRC' })
  const original = fake.client.deleteObject
  fake.client.deleteObject = (params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) => {
    if (String(params.Key) === 'src.txt') return callback({ statusCode: 403, code: 'AccessDenied' }, undefined)
    return original(params, callback)
  }
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'move', from: 'src.txt', to: 'dst.txt' }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  const outcome = await executeBatch(settings, fake.client as never, result.plan)
  assert.equal(outcome.items[0]?.status, 'copied_source_kept')
  assert.equal(outcome.items[0]?.code, 'source_delete_failed')
  assert.equal(fake.store.get('dst.txt')?.body.toString(), 'SRC')
  assert.equal(fake.store.get('src.txt')?.body.toString(), 'SRC')
})

test('a size mismatch after copy fails and keeps the source', async () => {
  const fake = fakeCos({ 'src.txt': 'SRC' })
  const original = fake.client.putObjectCopy
  fake.client.putObjectCopy = (params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) => {
    const source = decodeURIComponent(String(params.CopySource ?? '').split('.myqcloud.com/')[1] ?? '')
    const item = fake.store.get(source)
    if (item === undefined) return callback({ statusCode: 404, code: 'NoSuchKey' }, undefined)
    fake.store.set(String(params.Key), { body: Buffer.from('X'), etag: item.etag })
    callback(null, {})
  }
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'move', from: 'src.txt', to: 'dst.txt' }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  const outcome = await executeBatch(settings, fake.client as never, result.plan)
  assert.equal(outcome.items[0]?.status, 'failed')
  assert.equal(outcome.items[0]?.code, 'copy_verify_failed')
  assert.equal(fake.store.get('src.txt')?.body.toString(), 'SRC')
  fake.client.putObjectCopy = original
})

test('delete of a missing object is reported as skipped', async () => {
  const fake = fakeCos()
  const result = await compileBatch(
    settings,
    fake.client as never,
    [{ op: 'delete', key: 'gone.txt' }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  const outcome = await executeBatch(settings, fake.client as never, result.plan)
  assert.equal(outcome.items[0]?.status, 'skipped_missing')
  assert.equal(outcome.summary.skipped, 1)
})

test('upload reads the workspace file and verifies it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cos-batch-'))
  try {
    const file = join(dir, 'a.txt')
    await writeFile(file, 'UPLOAD')
    const fake = fakeCos()
    const result = await compileBatch(
      settings,
      fake.client as never,
      [{ op: 'upload', path: 'a.txt', absolutePath: file, key: 'up/a.txt' }],
      { onConflict: 'fail', onError: 'continue' },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    const outcome = await executeBatch(settings, fake.client as never, result.plan)
    assert.equal(outcome.items[0]?.status, 'ok')
    assert.equal(fake.store.get('up/a.txt')?.body.toString(), 'UPLOAD')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('on_error stop cancels the remaining serial items', async () => {
  const fake = fakeCos()
  const result = await compileBatch(
    settings,
    fake.client as never,
    [
      { op: 'move', from: 'missing.txt', to: 'a.txt' },
      { op: 'move', from: 'missing2.txt', to: 'b.txt' },
    ],
    { onConflict: 'fail', onError: 'stop' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  const outcome = await executeBatch(settings, fake.client as never, result.plan, 1)
  assert.equal(outcome.summary.failed, 1)
  assert.equal(outcome.summary.cancelled, 1)
})

test('prefix work stays inside the configured base prefix', async () => {
  const scoped = { ...settings, basePrefix: 'root/' }
  const fake = fakeCos({ 'root/old/a.txt': 'A' })
  const result = await compileBatch(
    scoped,
    fake.client as never,
    [{ op: 'move', from: 'old/', to: 'new/', recursive: true }],
    { onConflict: 'fail', onError: 'continue' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(
    result.plan.items.map((item) => [item.from, item.to]),
    [['old/a.txt', 'new/a.txt']],
  )
  const outcome = await executeBatch(scoped, fake.client as never, result.plan)
  assert.equal(outcome.items[0]?.status, 'ok')
  assert.equal(fake.store.has('root/old/a.txt'), false)
  assert.equal(fake.store.get('root/new/a.txt')?.body.toString(), 'A')
})

test('caps the number of top-level operations', async () => {
  const fake = fakeCos()
  const ops = Array.from({ length: 201 }, (_, index) => ({ op: 'delete', key: `k${index}` }))
  const result = await compileBatch(settings, fake.client as never, ops, { onConflict: 'fail', onError: 'continue' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'batch_too_large')
})
