import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePrefix, validateInput } from '../src/host/config.ts'
import { mapError, sanitizeKey, attachmentKey, CosRequestError } from '../src/host/cos.ts'
import { listObjects, signedDownloadUrl } from '../src/host/objects.ts'
import { isPreviewable } from '../src/host/preview.ts'

const settings = {
  role: 'default' as const,
  bucket: 'demo-1250000000',
  region: 'ap-beijing',
  secretId: 'id',
  secretKey: 'key',
  basePrefix: '',
  maxUploadBytes: 104857600,
  enabled: true,
}

test('key sanitisation keeps objects inside the configured prefix', () => {
  assert.equal(sanitizeKey('docs/a.txt', 'root/'), 'root/docs/a.txt')
  assert.throws(() => sanitizeKey('../etc/passwd', ''))
  assert.throws(() => sanitizeKey('/abs', ''))
  assert.throws(() => sanitizeKey('', ''))
})

test('attachment keys are content addressed', () => {
  const sha = 'ab'.repeat(32)
  assert.equal(attachmentKey('v1/', 'objects', sha), `v1/objects/ab/${sha}`)
})

test('prefix normalisation adds exactly one trailing slash', () => {
  assert.equal(normalizePrefix('v1'), 'v1/')
  assert.equal(normalizePrefix('/v1//'), 'v1/')
  assert.equal(normalizePrefix(''), '')
})

test('config validation checks bucket format and upload range', () => {
  assert.equal(validateInput('default', { bucket: 'demo-1250000000', region: 'ap-beijing' }), undefined)
  assert.match(validateInput('default', { bucket: 'demo', region: 'ap-beijing' }) ?? '', /name-appid/)
  assert.match(validateInput('default', { bucket: 'demo-1250000000', region: 'ap-beijing', maxUploadBytes: 10 }) ?? '', /上限/)
  assert.match(validateInput('default', { bucket: 'demo-1250000000', region: 'ap-beijing', maxPreviewBytes: 1000 }) ?? '', /预览/)
})

test('only previewable media types are materialised', () => {
  assert.equal(isPreviewable('text/markdown', 'README.md'), true)
  assert.equal(isPreviewable('image/png', 'pic'), true)
  assert.equal(isPreviewable('application/pdf', 'doc.pdf'), true)
  assert.equal(isPreviewable('application/octet-stream', 'blob.bin'), false)
})

test('cos errors map to stable codes', () => {
  assert.equal(mapError(new CosRequestError('nf', 404)).code, 'object_not_found')
  assert.equal(mapError(new CosRequestError('denied', 403)).code, 'cos_forbidden')
  assert.equal(mapError(new CosRequestError('bad key', 403, 'InvalidAccessKeyId')).code, 'credentials_invalid')
})

test('listing separates folders and decodes keys', async () => {
  const client = {
    getBucket: (_params: unknown, callback: (error: unknown, data: unknown) => void) =>
      callback(null, {
        CommonPrefixes: [{ Prefix: 'docs/' }],
        Contents: [{ Key: 'docs/a%20b.txt', Size: '12', LastModified: '2026-01-01T00:00:00Z' }],
        IsTruncated: 'false',
      }),
  } as never
  const page = await listObjects(settings, client, { prefix: '', marker: '', limit: 50, search: '' })
  assert.deepEqual(page.items.map((item) => [item.kind, item.name]), [['folder', 'docs'], ['file', 'a b.txt']])
})

test('signed download URL carries a disposition and expiry', async () => {
  const client = {
    getObjectUrl: (params: { Query?: Record<string, string>; Expires?: number }, callback: (error: unknown, data: unknown) => void) => {
      assert.equal(params.Expires, 300)
      assert.match(params.Query?.['response-content-disposition'] ?? '', /filename\*=UTF-8/)
      callback(null, { Url: 'https://example.com/x' })
    },
  } as never
  assert.equal(await signedDownloadUrl(settings, client, 'docs/a b.txt', 'a b.txt'), 'https://example.com/x')
})
