import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  archiveFolderName,
  importArchive,
  inspectArchive,
  normalizeArchivePrefix,
  receiveArchive,
  stripMatchingRoot,
  type ArchiveFile,
} from '../src/host/archive.ts'

const settings = {
  role: 'default' as const,
  bucket: 'demo-1250000000',
  region: 'ap-beijing',
  secretId: 'id',
  secretKey: 'key',
  basePrefix: '',
  maxUploadBytes: 10,
  maxPreviewBytes: 1024,
  maxArchiveBytes: 100,
  enabled: true,
}

function rawEntry(name: string, size: number, options: { flag?: number; mode?: number } = {}) {
  return {
    fileName: Buffer.from(name),
    uncompressedSize: size,
    generalPurposeBitFlag: options.flag ?? 0,
    externalFileAttributes: (options.mode ?? 0o100644) << 16,
  }
}

test('inspect keeps files and ignores directories and macOS metadata', () => {
  const result = inspectArchive(
    [rawEntry('a.txt', 5), rawEntry('sub/', 0, { mode: 0o040755 }), rawEntry('sub/b.txt', 6), rawEntry('__MACOSX/junk', 3)],
    settings,
  )
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.files.map((file) => [file.name, file.size]), [['a.txt', 5], ['sub/b.txt', 6]])
  assert.equal(result.ignored, 2)
})

test('inspect rejects traversal, absolute paths and symlinks', () => {
  const traversal = inspectArchive([rawEntry('../evil.txt', 1)], settings)
  assert.match(traversal.errors.join('\n'), /\.\./)
  const absolute = inspectArchive([rawEntry('/etc/passwd', 1)], settings)
  assert.match(absolute.errors.join('\n'), /绝对路径/)
  const symlink = inspectArchive([rawEntry('link', 1, { mode: 0o120777 })], settings)
  assert.match(symlink.errors.join('\n'), /符号链接/)
})

test('inspect rejects encrypted entries, duplicates and size overflows', () => {
  assert.match(inspectArchive([rawEntry('a.txt', 1, { flag: 1 })], settings).errors.join('\n'), /加密/)
  assert.match(inspectArchive([rawEntry('a.txt', 1), rawEntry('a.txt', 1)], settings).errors.join('\n'), /重名/)
  assert.match(
    inspectArchive([rawEntry('big.bin', 11)], { ...settings, maxArchiveBytes: 10 }).errors.join('\n'),
    /压缩包上限/,
  )
  assert.match(
    inspectArchive([rawEntry('a.bin', 6), rawEntry('b.bin', 6)], { ...settings, maxArchiveBytes: 8 }).errors.join('\n'),
    /总量超过上限/,
  )
})

test('inspect decodes GBK names without the UTF-8 flag', () => {
  const entry = rawEntry('中文.txt', 3)
  entry.fileName = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x74, 0x78, 0x74])
  const result = inspectArchive([entry], settings)
  assert.deepEqual(result.errors, [])
  assert.equal(result.files[0]?.name, '中文.txt')
})

test('folder name derives from the zip filename', () => {
  assert.equal(archiveFolderName('photos.zip'), 'photos')
  assert.equal(archiveFolderName('Photos.ZIP'), 'Photos')
  assert.equal(archiveFolderName('dir/photos.zip'), 'photos')
  assert.equal(archiveFolderName('photos'), 'photos')
  assert.throws(() => archiveFolderName(''), /无效/)
  assert.throws(() => archiveFolderName('.zip'), /无效/)
  assert.throws(() => archiveFolderName('..'), /无效/)
})

test('a matching zip root folder is stripped exactly once', () => {
  const nested = [file('photos/a.jpg', 'A'), file('photos/sub/b.jpg', 'B')]
  assert.deepEqual(stripMatchingRoot(nested, 'photos').map((item) => item.name), ['a.jpg', 'sub/b.jpg'])
  const mixed = [file('photos/a.jpg', 'A'), file('other/b.jpg', 'B')]
  assert.deepEqual(stripMatchingRoot(mixed, 'photos').map((item) => item.name), ['photos/a.jpg', 'other/b.jpg'])
})

test('prefix normalization adds one trailing slash and rejects traversal', () => {
  assert.equal(normalizeArchivePrefix('dir'), 'dir/')
  assert.equal(normalizeArchivePrefix('/dir/'), 'dir/')
  assert.equal(normalizeArchivePrefix(''), '')
  assert.throws(() => normalizeArchivePrefix('../x'))
})

function fakeClient(store = new Map<string, string>()) {
  const calls: string[] = []
  const client = {
    headObject(params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) {
      const key = String(params.Key)
      if (!store.has(key)) return callback({ statusCode: 404, code: 'NoSuchKey' }, undefined)
      callback(null, { headers: { 'content-length': String(store.get(key)?.length ?? 0) } })
    },
    putObject(params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) {
      const chunks: Buffer[] = []
      const stream = params.Body as NodeJS.ReadableStream
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      stream.on('error', (error: Error) => callback(error, undefined))
      stream.on('end', () => {
        store.set(String(params.Key), Buffer.concat(chunks).toString())
        calls.push(`put:${String(params.Key)}`)
        callback(null, {})
      })
    },
    getBucket() {},
    putObjectCopy() {},
    getObject() {},
    deleteObject() {},
    getObjectUrl() {},
  }
  return { client, store, calls }
}

function fakeZip(files: ArchiveFile[]) {
  return {
    openReadStream(entry: { body?: string }, callback: (error: unknown, stream: NodeJS.ReadableStream) => void) {
      callback(null, Readable.from([Buffer.from(entry.body ?? '')]))
    },
    close() {},
  }
}

function file(name: string, body: string): ArchiveFile {
  return { entry: { body }, name, size: Buffer.byteLength(body) }
}

test('importArchive streams entries into COS and skips existing keys', async () => {
  const fake = fakeClient(new Map([['up/a.txt', 'OLD']]))
  const outcome = await importArchive({
    settings: { ...settings, maxUploadBytes: 1024 },
    client: fake.client as never,
    zip: fakeZip([file('a.txt', 'NEW'), file('b.txt', 'B')]),
    files: [file('a.txt', 'NEW'), file('b.txt', 'B')],
    prefix: 'up/',
    overwrite: false,
  })
  assert.equal(outcome.uploaded, 1)
  assert.equal(outcome.skipped, 1)
  assert.equal(outcome.failed, 0)
  assert.equal(fake.store.get('up/a.txt'), 'OLD')
  assert.equal(fake.store.get('up/b.txt'), 'B')
})

test('importArchive overwrites when requested and reports failures', async () => {
  const fake = fakeClient(new Map([['up/a.txt', 'OLD']]))
  const zip = fakeZip([file('a.txt', 'NEW')])
  const good = await importArchive({
    settings: { ...settings, maxUploadBytes: 1024 },
    client: fake.client as never,
    zip,
    files: [file('a.txt', 'NEW')],
    prefix: 'up/',
    overwrite: true,
  })
  assert.equal(good.uploaded, 1)
  assert.equal(fake.store.get('up/a.txt'), 'NEW')

  const broken = fake.client.putObject
  fake.client.putObject = (_params: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) => {
    callback({ statusCode: 500, code: 'InternalError' }, undefined)
  }
  const failed = await importArchive({
    settings: { ...settings, maxUploadBytes: 1024 },
    client: fake.client as never,
    zip,
    files: [file('a.txt', 'NEW')],
    prefix: 'up/',
    overwrite: true,
  })
  assert.equal(failed.failed, 1)
  assert.match(failed.errors.join('\n'), /a\.txt/)
  fake.client.putObject = broken
})

test('receiveArchive writes the body and enforces the limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cos-archive-'))
  try {
    const path = join(dir, 'ok.zip')
    const ok = await receiveArchive(Readable.from([Buffer.from('hello')]) as never, path, 10)
    assert.equal(ok.ok, true)
    assert.equal((await stat(path)).size, 5)

    const rejectedPath = join(dir, 'too-big.zip')
    const rejected = await receiveArchive(Readable.from([Buffer.from('0123456789')]) as never, rejectedPath, 5)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'upload_too_large')
    await assert.rejects(stat(rejectedPath))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
