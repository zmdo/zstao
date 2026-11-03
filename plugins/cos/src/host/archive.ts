import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import yauzl from 'yauzl'
import { recordAudit } from './audit.ts'
import { DEFAULT_ARCHIVE_EXCLUDE, type BucketSettings, type Queryable } from './config.ts'
import { mapError, sanitizeKey, type CosClient } from './cos.ts'
import { contentTypeOf, putObject, statObject } from './objects.ts'

/** Hard cap on entries; independent from the byte limit. */
export const ARCHIVE_MAX_ENTRIES = 1000

const ARCHIVE_DIR = join(tmpdir(), 'dsh-cos-archive')
const STALE_MS = 6 * 60 * 60 * 1000

export class ArchiveError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
  }
}

export interface ReceiveResult {
  ok: boolean
  bytes: number
  code?: string
  detail?: string
}

export interface ArchiveFile {
  entry: unknown
  name: string
  size: number
}

export interface ArchiveInspection {
  files: ArchiveFile[]
  ignored: number
  filtered: number
  errors: string[]
}

export interface ArchiveItem {
  key: string
  name: string
  size: number
  status: 'uploaded' | 'skipped' | 'failed'
  code?: string
  detail?: string
}

export interface ArchiveOutcome {
  total: number
  filtered: number
  uploaded: number
  skipped: number
  failed: number
  bytes: number
  items: ArchiveItem[]
  errors: string[]
}

/** Remove leftover zip files from crashed requests. Best effort. */
export async function pruneArchives(now = Date.now()): Promise<void> {
  try {
    for (const file of await readdir(ARCHIVE_DIR)) {
      const path = join(ARCHIVE_DIR, file)
      try {
        const info = await stat(path)
        if (now - info.mtimeMs > STALE_MS) await unlink(path)
      } catch {
        // A concurrent request may have removed it already.
      }
    }
  } catch {
    // The directory does not exist yet.
  }
}

export async function createArchivePath(archiveId: string): Promise<string> {
  await mkdir(ARCHIVE_DIR, { recursive: true, mode: 0o700 })
  return join(ARCHIVE_DIR, `${archiveId}.zip`)
}

/** Stream the request body to a private temporary zip file, enforcing the byte limit. */
export async function receiveArchive(request: IncomingMessage, path: string, maxBytes: number): Promise<ReceiveResult> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const out = createWriteStream(path, { mode: 0o600 })
  let bytes = 0
  let settled = false
  let aborting = false
  return new Promise((resolve) => {
    const finish = (result: ReceiveResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const abort = (code: string, detail: string) => {
      if (settled || aborting) return
      aborting = true
      request.destroy()
      out.destroy()
      void rm(path, { force: true }).finally(() => finish({ ok: false, bytes, code, detail }))
    }
    request.on('data', (chunk: Buffer) => {
      if (settled || aborting) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        abort('upload_too_large', `压缩包超过上限 ${Math.floor(maxBytes / 1048576)}MB`)
        return
      }
      if (!out.write(chunk)) {
        request.pause()
        out.once('drain', () => request.resume())
      }
    })
    request.on('end', () => {
      if (!settled && !aborting) out.end()
    })
    request.on('aborted', () => abort('upload_aborted', '上传已中断'))
    request.on('error', () => abort('upload_aborted', '上传已中断'))
    out.on('error', () => abort('upload_failed', '写入临时文件失败'))
    out.on('finish', () => {
      if (!aborting) finish({ ok: true, bytes })
    })
  })
}

function openZip(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true }, (error: Error | null, zip: unknown) => {
      if (error) reject(error)
      else resolve(zip)
    })
  })
}

function readEntries(zip: any): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const entries: any[] = []
    zip.on('entry', (entry: any) => {
      entries.push(entry)
      zip.readEntry()
    })
    zip.on('end', () => resolve(entries))
    zip.on('error', (error: Error) => reject(error))
    try {
      zip.readEntry()
    } catch (error) {
      reject(error)
    }
  })
}

function decodeName(entry: any): string {
  const raw = Buffer.isBuffer(entry.fileName) ? entry.fileName : Buffer.from(String(entry.fileName))
  if ((entry.generalPurposeBitFlag & 0x800) !== 0) return raw.toString('utf8')
  try {
    return new TextDecoder('gbk').decode(raw)
  } catch {
    return raw.toString('utf8')
  }
}

function normalizeEntryName(name: string): { name?: string; error?: string } {
  let normalized = name.replace(/\\/g, '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (normalized === '') return { error: '空文件名' }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return { error: '绝对路径' }
  if (normalized.includes('\u0000')) return { error: '文件名包含空字符' }
  const parts = normalized.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return { error: '路径包含 . 或 ..' }
  if (normalized.length > 1024) return { error: '路径过长' }
  return { name: normalized }
}

function compileArchiveFilters(value: string | undefined, errors: string[]): RegExp[] {
  const source = value === undefined ? DEFAULT_ARCHIVE_EXCLUDE : value
  const filters: RegExp[] = []
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const pattern = line.trim()
    if (pattern === '') continue
    try {
      filters.push(new RegExp(pattern))
    } catch {
      errors.push(`排除规则第 ${index + 1} 行不是合法正则`)
    }
  }
  return filters
}

/** Match a zip entry path against the user-configured exclude expressions. */
function isFiltered(filters: RegExp[], path: string): boolean {
  return filters.some((filter) => filter.test(path))
}

/** Validate every entry before the first upload so a bad archive is rejected atomically. */
export function inspectArchive(raw: any[], settings: BucketSettings): ArchiveInspection {
  const errors: string[] = []
  const files: ArchiveFile[] = []
  const seen = new Set<string>()
  let ignored = 0
  let filtered = 0
  let total = 0
  if (raw.length > ARCHIVE_MAX_ENTRIES) {
    errors.push(`压缩包内条目超过 ${ARCHIVE_MAX_ENTRIES} 个`)
    return { files, ignored, filtered, errors }
  }
  const filters = compileArchiveFilters(settings.archiveExclude, errors)
  if (errors.length > 0) return { files, ignored, filtered, errors }
  for (const entry of raw) {
    if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
      errors.push('不支持加密 zip')
      continue
    }
    const kind = ((entry.externalFileAttributes >>> 16) & 0xffff) & 0o170000
    if (kind === 0o120000) {
      errors.push('不支持符号链接')
      continue
    }
    const decoded = decodeName(entry)
    const candidate = decoded.replace(/\\/g, '/')
    if (isFiltered(filters, candidate)) {
      filtered += 1
      continue
    }
    if (decoded.endsWith('/') || kind === 0o040000) {
      ignored += 1
      continue
    }
    const normalized = normalizeEntryName(decoded)
    if (normalized.error !== undefined) {
      errors.push(`${decoded}: ${normalized.error}`)
      continue
    }
    const name = normalized.name as string
    if (isFiltered(filters, name)) {
      filtered += 1
      continue
    }
    if (seen.has(name)) {
      errors.push(`${name}: 压缩包内有重名文件`)
      continue
    }
    seen.add(name)
    const size = Number(entry.uncompressedSize ?? 0)
    if (!Number.isFinite(size) || size < 0) {
      errors.push(`${name}: 大小不合法`)
      continue
    }
    if (size > settings.maxArchiveBytes) {
      errors.push(`${name}: 超过压缩包上限 ${Math.floor(settings.maxArchiveBytes / 1048576)}MB`)
      continue
    }
    total += size
    if (total > settings.maxArchiveBytes) {
      errors.push(`解压后总量超过上限 ${Math.floor(settings.maxArchiveBytes / 1048576)}MB`)
      break
    }
    files.push({ entry, name, size })
  }
  if (files.length === 0 && errors.length === 0 && filtered === 0) errors.push('压缩包内没有可上传的文件')
  return { files, ignored, filtered, errors }
}

export function normalizeArchivePrefix(value: string): string {
  const cleaned = value.trim().replace(/^\/+/, '')
  if (cleaned === '') return ''
  if (cleaned.split('/').includes('..')) throw new ArchiveError('invalid_prefix', 'prefix 不能包含 ..')
  return cleaned.endsWith('/') ? cleaned : `${cleaned}/`
}

/** Avoid photos/photos when a zip already wraps every file in a folder with its own name. */
export function stripMatchingRoot(files: ArchiveFile[], folder: string): ArchiveFile[] {
  const root = `${folder}/`
  if (files.length === 0 || !files.every((file) => file.name.startsWith(root))) return files
  return files.map((file) => ({ ...file, name: file.name.slice(root.length) }))
}

/** Derive the destination folder from the uploaded zip filename. */
export function archiveFolderName(value: string): string {
  const base = value.trim().split(/[\\/]/).pop() ?? ''
  const name = base.replace(/\.zip$/i, '').trim()
  if (name === '' || name === '.' || name === '..') {
    throw new ArchiveError('invalid_archive_name', 'zip 文件名无效')
  }
  if (name.includes('\u0000') || name.length > 255) {
    throw new ArchiveError('invalid_archive_name', 'zip 文件名过长或包含非法字符')
  }
  return name
}

function entryStream(zip: any, entry: unknown): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error: Error | null, stream: NodeJS.ReadableStream) => {
      if (error) reject(error)
      else resolve(stream)
    })
  })
}

async function destinationExists(settings: BucketSettings, client: CosClient, key: string): Promise<boolean> {
  try {
    await statObject(settings, client, key)
    return true
  } catch (cause) {
    const error = cause as { statusCode?: number; code?: string; error?: { Code?: string } }
    if (error?.statusCode === 404 || error?.code === 'NoSuchKey' || error?.error?.Code === 'NoSuchKey') return false
    throw cause
  }
}

export interface ImportArchiveOptions {
  settings: BucketSettings
  client: CosClient
  zip: any
  files: ArchiveFile[]
  prefix: string
  overwrite: boolean
  filtered?: number
}

/** Upload each zip entry straight from its decompression stream; no extracted files on disk. */
export async function importArchive(options: ImportArchiveOptions): Promise<ArchiveOutcome> {
  const { settings, client, zip, files, prefix, overwrite } = options
  const filtered = options.filtered ?? 0
  const items: ArchiveItem[] = []
  let uploaded = 0
  let skipped = 0
  let failed = 0
  let bytes = 0

  for (const file of files) {
    const key = `${prefix}${file.name}`
    try {
      sanitizeKey(key, '')
    } catch (cause) {
      failed += 1
      items.push({ key, name: file.name, size: file.size, status: 'failed', code: 'key_invalid', detail: cause instanceof Error ? cause.message : String(cause) })
      continue
    }

    try {
      if (!overwrite && (await destinationExists(settings, client, key))) {
        skipped += 1
        items.push({ key, name: file.name, size: file.size, status: 'skipped', code: 'object_exists', detail: '目标已存在' })
        continue
      }
    } catch (cause) {
      failed += 1
      const mapped = mapError(cause)
      items.push({ key, name: file.name, size: file.size, status: 'failed', code: mapped.code, detail: mapped.detail })
      continue
    }

    let stream: NodeJS.ReadableStream | undefined
    try {
      stream = await entryStream(zip, file.entry)
      await putObject(settings, client, key, stream, file.size, contentTypeOf(file.name))
      const head = await statObject(settings, client, key)
      if (head.size !== file.size) throw new Error(`目标大小 ${head.size} 与压缩包内 ${file.size} 不一致`)
      uploaded += 1
      bytes += file.size
      items.push({ key, name: file.name, size: file.size, status: 'uploaded' })
    } catch (cause) {
      if (stream !== undefined && typeof (stream as { destroy?: () => void }).destroy === 'function') (stream as { destroy: () => void }).destroy()
      failed += 1
      const mapped = mapError(cause)
      items.push({ key, name: file.name, size: file.size, status: 'failed', code: mapped.code, detail: mapped.detail })
    }
  }

  return {
    total: files.length,
    filtered,
    uploaded,
    skipped,
    failed,
    bytes,
    items,
    errors: items.filter((item) => item.status === 'failed').slice(0, 20).map((item) => `${item.name}: ${item.detail ?? item.code ?? '失败'}`),
  }
}

export interface ArchiveAuditInput {
  archiveId: string
  prefix: string
  outcome: ArchiveOutcome
  pool: Queryable
}

export async function recordArchiveAudit(input: ArchiveAuditInput): Promise<void> {
  for (const item of input.outcome.items) {
    if (item.status === 'skipped') continue
    await recordAudit(input.pool, {
      sessionId: null,
      actor: 'console',
      action: 'upload',
      objectKey: item.key,
      sizeBytes: item.size,
      ok: item.status === 'uploaded',
      error: item.status === 'uploaded' ? null : item.code ?? 'upload_failed',
      detail: { archiveId: input.archiveId, entry: item.name, status: item.status, detail: item.detail ?? null },
    })
  }
  await recordAudit(input.pool, {
    sessionId: null,
    actor: 'console',
    action: 'batch',
    objectKey: '',
    sizeBytes: input.outcome.bytes,
    ok: input.outcome.failed === 0,
    error: null,
    detail: {
      archiveId: input.archiveId,
      kind: 'zip',
      prefix: input.prefix,
      total: input.outcome.total,
      filtered: input.outcome.filtered,
      uploaded: input.outcome.uploaded,
      skipped: input.outcome.skipped,
      failed: input.outcome.failed,
      bytes: input.outcome.bytes,
    },
  })
}

export interface InspectResult {
  zip: any
  inspection: ArchiveInspection
}

/** Open a saved zip and inspect its entries; the caller owns zip.close(). */
export async function openAndInspect(path: string, settings: BucketSettings): Promise<InspectResult> {
  let zip: any
  try {
    zip = await openZip(path)
  } catch (cause) {
    throw new ArchiveError('invalid_archive', `无法读取 zip：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  try {
    const raw = await readEntries(zip)
    return { zip, inspection: inspectArchive(raw, settings) }
  } catch (cause) {
    try {
      zip.close()
    } catch {
      // ignore close failures
    }
    throw new ArchiveError('invalid_archive', `无法读取 zip：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
