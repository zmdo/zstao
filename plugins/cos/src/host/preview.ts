import { createHash } from 'node:crypto'
import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createClient, invoke, sanitizeKey } from './cos.ts'
import type { BucketSettings } from './config.ts'

export const PREVIEW_CACHE_DIR = process.env.COS_PREVIEW_CACHE_DIR ?? join(homedir(), '.smp', 'cache', 'cos-preview')
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000

export class PreviewError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PreviewError'
    this.code = code
  }
}

interface SessionLike {
  id?: string
}

interface SessionsFace {
  get(id: string): SessionLike | undefined
}

interface WorkingDirectoryFace {
  get(session: SessionLike): string
}

const EXTENSIONS: Record<string, string> = {
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
  'text/html': '.html',
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const TEXTUAL = (contentType: string): boolean =>
  contentType.startsWith('text/') || contentType === 'application/json' || contentType === 'application/xml'

export function isPreviewable(contentType: string, name: string): boolean {
  if (TEXTUAL(contentType) || contentType === 'application/pdf' || contentType.startsWith('image/')) return true
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  return ['.md', '.txt', '.json', '.csv', '.log', '.yaml', '.yml', '.ts', '.js', '.css', '.html', '.xml', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
}

function withExtension(name: string, contentType: string): string {
  if (name.includes('.')) return name
  return `${name}${EXTENSIONS[contentType] ?? '.txt'}`
}

function workspaceRoot(ctx: Context, sessionId: string): string {
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryFace | undefined
  const session = sessions?.get(sessionId)
  if (session === undefined) throw new PreviewError('session_not_found', '会话不存在或已关闭')
  if (workingDirectory === undefined) throw new PreviewError('workspace_unavailable', '工作区服务不可用')
  try {
    return workingDirectory.get(session)
  } catch (cause) {
    throw new PreviewError('workspace_unavailable', cause instanceof Error ? cause.message : String(cause))
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function downloadText(settings: BucketSettings, key: string): Promise<Buffer> {
  const data = await invoke(createClient(settings), 'getObject', {
    Bucket: settings.bucket,
    Region: settings.region,
    Key: sanitizeKey(key, settings.basePrefix),
  })
  return Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body)
}

export interface Materialized {
  path: string
  absolute: string
  size: number
  etag: string
  contentType: string
  linked: boolean
  downloaded: boolean
}

export async function materialize(
  ctx: Context,
  settings: BucketSettings,
  sessionId: string,
  key: string,
): Promise<Materialized> {
  const workspace = workspaceRoot(ctx, sessionId)
  const objectKey = sanitizeKey(key, settings.basePrefix)
  const head = await invoke(createClient(settings), 'headObject', {
    Bucket: settings.bucket,
    Region: settings.region,
    Key: objectKey,
  })
  const etag = String(head.headers?.etag ?? head.ETag ?? '').replace(/"/g, '')
  const size = Number(head.headers?.['content-length'] ?? 0)
  const contentType = String(head.headers?.['content-type'] ?? 'application/octet-stream')
  if (size > settings.maxPreviewBytes) {
    throw new PreviewError('preview_too_large', `文件 ${size} 字节，超过预览上限 ${Math.floor(settings.maxPreviewBytes / 1048576)}MB`)
  }
  if (!isPreviewable(contentType, key)) {
    throw new PreviewError('unsupported_preview', '这个文件类型不支持在线预览')
  }
  const sha = createHash('sha1').update(key).digest('hex').slice(0, 12)
  const base = withExtension(key.split('/').pop() ?? 'file', contentType)
  const globalDir = join(PREVIEW_CACHE_DIR, etag.slice(0, 12))
  const globalPath = join(globalDir, `${sha}-${base}`)
  const metaPath = `${globalPath}.meta.json`
  let downloaded = false
  if (!(await exists(globalPath))) {
    const body = await downloadText(settings, key)
    if (body.byteLength > settings.maxPreviewBytes) {
      throw new PreviewError('preview_too_large', '文件超过预览上限')
    }
    await mkdir(globalDir, { recursive: true })
    const temporary = `${globalPath}.${process.pid}.tmp`
    await writeFile(temporary, body)
    await rename(temporary, globalPath)
    await writeFile(metaPath, JSON.stringify({ key, etag, size, contentType, createdAt: Date.now(), lastAccessAt: Date.now() }))
    downloaded = true
  } else {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { lastAccessAt?: number }
      meta.lastAccessAt = Date.now()
      await writeFile(metaPath, JSON.stringify(meta))
    } catch {
      // A cache entry without metadata is still usable; the janitor skips it.
    }
  }
  const relativePath = join('.cos-cache', `${sha}-${base}`)
  const target = join(workspace, relativePath)
  await mkdir(dirname(target), { recursive: true })
  let linked = false
  if (!(await exists(target))) {
    try {
      await link(globalPath, target)
      linked = true
    } catch {
      await copyFile(globalPath, target)
    }
  } else {
    linked = true
  }
  return { path: relativePath, absolute: target, size, etag, contentType, linked, downloaded }
}

async function cacheSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (!entry.name.endsWith('.meta.json')) total += (await stat(path).catch(() => ({ size: 0 }))).size
    }
  }
  await walk(dir)
  return total
}

export async function cleanupPreviewCache(now = Date.now()): Promise<void> {
  const entries = await readdir(PREVIEW_CACHE_DIR, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(PREVIEW_CACHE_DIR, entry.name)
    const files = await readdir(dir).catch(() => [])
    for (const file of files) {
      if (!file.endsWith('.meta.json')) continue
      const metaPath = join(dir, file)
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { lastAccessAt?: number; createdAt?: number }
        const last = meta.lastAccessAt ?? meta.createdAt ?? 0
        if (now - last > CACHE_TTL_MS) {
          await rm(join(dir, file), { force: true })
          await rm(join(dir, file.slice(0, -'.meta.json'.length)), { force: true })
        }
      } catch {
        // Keep unreadable metadata until a later pass or manual cleanup.
      }
    }
  }
  if ((await cacheSize(PREVIEW_CACHE_DIR)) > CACHE_MAX_BYTES) {
    const candidates: { path: string; meta: string; at: number }[] = []
    for (const entry of await readdir(PREVIEW_CACHE_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue
      const dir = join(PREVIEW_CACHE_DIR, entry.name)
      for (const file of await readdir(dir).catch(() => [])) {
        if (!file.endsWith('.meta.json')) continue
        const metaPath = join(dir, file)
        try {
          const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { lastAccessAt?: number; createdAt?: number }
          candidates.push({ path: join(dir, file.slice(0, -'.meta.json'.length)), meta: metaPath, at: meta.lastAccessAt ?? meta.createdAt ?? 0 })
        } catch {
          // Ignore malformed entries.
        }
      }
    }
    candidates.sort((a, b) => a.at - b.at)
    let total = await cacheSize(PREVIEW_CACHE_DIR)
    for (const candidate of candidates) {
      if (total <= CACHE_MAX_BYTES * 0.8) break
      const size = (await stat(candidate.path).catch(() => ({ size: 0 }))).size
      await rm(candidate.path, { force: true })
      await rm(candidate.meta, { force: true })
      total -= size
    }
  }
}

export function startPreviewCleanup(): () => void {
  const timer = setInterval(() => {
    void cleanupPreviewCache()
  }, CLEANUP_INTERVAL_MS)
  void cleanupPreviewCache()
  return () => clearInterval(timer)
}

export function previewRelativeToWorkspace(workspace: string, absolute: string): string {
  return relative(workspace, absolute)
}
