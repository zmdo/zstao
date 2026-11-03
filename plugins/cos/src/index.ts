import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { ArchiveError, archiveFolderName, createArchivePath, importArchive, normalizeArchivePrefix, openAndInspect, pruneArchives, receiveArchive, recordArchiveAudit, stripMatchingRoot } from './host/archive.ts'
import { queryAudit, recordAudit } from './host/audit.ts'
import { compileBatch, executeBatch, type BatchOpInput, type ConflictPolicy, type ErrorPolicy } from './host/batch.ts'
import { recordBatchAudit } from './host/batch-audit.ts'
import { clearBuckets, DEFAULT_ARCHIVE_EXCLUDE, isRole, loadBucket, loadBuckets, saveBucket, validateInput, type BucketInput, type Queryable, type Role, type Secrets } from './host/config.ts'
import { createClient, invoke, mapError, sanitizeKey } from './host/cos.ts'
import { deleteObject, listObjects, putObject, readObjectText, signedDownloadUrl, signedInlineUrl, statObject } from './host/objects.ts'
import { materialize, PreviewError, startPreviewCleanup } from './host/preview.ts'
import { registerCosTools } from './host/tools.ts'

const PREFIX = '/console-api/cos'

interface HostCtx extends Context {
  database: { pool: Queryable }
  secrets: Secrets
  consoleSession: { read(cookieHeader: string): Promise<unknown> }
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

export const inject = ['database', 'secrets', 'consoleSession', 'webServer', 'tools']

export async function* apply(ctx: HostCtx): AsyncGenerator<() => void> {
  ctx.inject(['tools'], (scope: Context) => {
    registerCosTools(scope, { pool: ctx.database.pool, secrets: ctx.secrets })
  })
  yield ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (request, response) => handle(ctx, request, response),
  })
  yield startPreviewCleanup()
}

async function handle(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if ((await ctx.consoleSession.read(cookieHeader(request))) === undefined) {
    sendJson(response, 401, { code: 'auth_required', detail: '未登录' })
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname.slice(PREFIX.length) || '/'
    if (path === '/config' && request.method === 'GET') return await readConfig(ctx, response)
    if (path === '/config' && request.method === 'PUT') return await writeConfig(ctx, request, response)
    if (path === '/config' && request.method === 'DELETE') return await removeConfig(ctx, response)
    if (path === '/config/test' && request.method === 'POST') return await testConfig(ctx, request, response)
    if (path === '/batch' && request.method === 'POST') return await batch(ctx, request, response)
    if (path === '/archive' && request.method === 'POST') return await archive(ctx, request, url, response)
    if (path === '/objects' && request.method === 'GET') return await list(ctx, url, response)
    if (path === '/objects' && request.method === 'POST') return await upload(ctx, request, url, response)
    if (path === '/objects' && request.method === 'DELETE') return await remove(ctx, url, request, response)
    if (path === '/objects/download' && request.method === 'GET') return await download(ctx, url, request, response)
    if (path === '/objects/raw' && request.method === 'GET') return await raw(ctx, url, response)
    if (path === '/objects/text' && request.method === 'GET') return await text(ctx, url, response)
    if (path === '/materialize' && request.method === 'POST') return await materializeObject(ctx, request, response)
    if (path === '/audit' && request.method === 'GET') return await readAudit(ctx, url, response)
    sendJson(response, 404, { code: 'not_found', detail: '没有这个接口' })
  } catch (cause) {
    sendJson(response, 500, { code: 'internal', detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

async function batch(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const body = await readJson(request)
  if (body === undefined) return sendJson(response, 400, { code: 'bad_request', detail: '请求无法读取' })
  const ops = body.ops
  if (!Array.isArray(ops) || ops.length === 0) {
    return sendJson(response, 400, { code: 'batch_empty', detail: 'ops 不能为空' })
  }
  if (ops.some((op) => op !== null && typeof op === 'object' && (op as Record<string, unknown>).op === 'upload')) {
    return sendJson(response, 400, { code: 'upload_requires_agent', detail: '控制台批量上传请使用文件上传入口' })
  }
  const conflict = body.on_conflict
  if (conflict !== undefined && conflict !== 'fail' && conflict !== 'skip' && conflict !== 'overwrite') {
    return sendJson(response, 400, { code: 'invalid_batch', detail: 'on_conflict 必须是 fail、skip 或 overwrite' })
  }
  const onError = body.on_error
  if (onError !== undefined && onError !== 'continue' && onError !== 'stop') {
    return sendJson(response, 400, { code: 'invalid_batch', detail: 'on_error 必须是 continue 或 stop' })
  }

  const client = createClient(settings)
  const compiled = await compileBatch(settings, client, ops as BatchOpInput[], {
    onConflict: (conflict ?? 'fail') as ConflictPolicy,
    onError: (onError ?? 'continue') as ErrorPolicy,
  })
  if (!compiled.ok) {
    return sendJson(response, 400, { code: compiled.code, detail: compiled.detail, problems: compiled.problems })
  }
  if (body.dry_run === true) {
    return sendJson(response, 200, {
      dryRun: true,
      planId: compiled.plan.planId,
      summary: compiled.plan.summary,
      sample: compiled.plan.sample,
      warnings: compiled.plan.warnings,
    })
  }

  const outcome = await executeBatch(settings, client, compiled.plan)
  await recordBatchAudit(ctx.database.pool, {
    actor: 'console',
    sessionId: null,
    plan: compiled.plan,
    outcome,
  })
  sendJson(response, 200, outcome)
}

async function archive(ctx: HostCtx, request: IncomingMessage, url: URL, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const length = Number(request.headers['content-length'] ?? '')
  if (!Number.isFinite(length) || length < 0) {
    return sendJson(response, 411, { code: 'length_required', detail: '需要 Content-Length' })
  }
  if (length > settings.maxArchiveBytes) {
    return sendJson(response, 413, {
      code: 'upload_too_large',
      detail: `压缩包超过上限 ${Math.floor(settings.maxArchiveBytes / 1048576)}MB`,
    })
  }
  let prefix: string
  try {
    prefix = normalizeArchivePrefix(url.searchParams.get('prefix') ?? '')
  } catch (cause) {
    const code = cause instanceof ArchiveError ? cause.code : 'invalid_prefix'
    const detail = cause instanceof Error ? cause.message : String(cause)
    return sendJson(response, 400, { code, detail })
  }
  let folder: string
  try {
    folder = archiveFolderName(url.searchParams.get('name') ?? '')
  } catch (cause) {
    const code = cause instanceof ArchiveError ? cause.code : 'invalid_archive_name'
    const detail = cause instanceof Error ? cause.message : String(cause)
    return sendJson(response, 400, { code, detail })
  }
  const targetPrefix = `${prefix}${folder}/`
  const overwrite = url.searchParams.get('overwrite') === 'true'
  const archiveId = randomUUID()
  const path = await createArchivePath(archiveId)
  try {
    await pruneArchives()
    const received = await receiveArchive(request, path, settings.maxArchiveBytes)
    if (!received.ok) {
      return sendJson(response, received.code === 'upload_too_large' ? 413 : 400, {
        code: received.code ?? 'upload_failed',
        detail: received.detail ?? '上传失败',
      })
    }

    let opened
    try {
      opened = await openAndInspect(path, settings)
    } catch (cause) {
      if (cause instanceof ArchiveError) return sendJson(response, 400, { code: cause.code, detail: cause.message })
      throw cause
    }
    try {
      if (opened.inspection.errors.length > 0) {
        return sendJson(response, 400, {
          code: 'invalid_archive',
          detail: '压缩包校验失败',
          errors: opened.inspection.errors.slice(0, 20),
          ignored: opened.inspection.ignored,
          filtered: opened.inspection.filtered,
        })
      }
      const outcome = await importArchive({
        settings,
        client: createClient(settings),
        zip: opened.zip,
        files: stripMatchingRoot(opened.inspection.files, folder),
        prefix: targetPrefix,
        overwrite,
        filtered: opened.inspection.filtered,
      })
      await recordArchiveAudit({ archiveId, prefix: targetPrefix, outcome, pool: ctx.database.pool })
      sendJson(response, 200, { archiveId, prefix: targetPrefix, folder, ignored: opened.inspection.ignored, ...outcome })
    } finally {
      try {
        opened.zip.close()
      } catch {
        // The zip may already be closed after a read error.
      }
    }
  } finally {
    await rm(path, { force: true }).catch(() => undefined)
  }
}

async function readConfig(ctx: HostCtx, response: ServerResponse): Promise<void> {
  const both = await loadBuckets(ctx.database.pool, ctx.secrets)
  const mask = (settings: { role: Role; bucket: string; region: string; secretId: string; basePrefix: string; maxUploadBytes: number; maxPreviewBytes: number; maxArchiveBytes: number; archiveExclude: string; enabled: boolean; secretKey: string } | undefined) =>
    settings === undefined
      ? null
      : {
          role: settings.role,
          bucket: settings.bucket,
          region: settings.region,
          secretId: settings.secretId.length <= 8 ? '…' : `${settings.secretId.slice(0, 6)}…`,
          hasSecretKey: settings.secretKey !== '',
          basePrefix: settings.basePrefix,
          maxUploadBytes: settings.maxUploadBytes,
          maxPreviewBytes: settings.maxPreviewBytes,
          maxArchiveBytes: settings.maxArchiveBytes,
          archiveExclude: settings.archiveExclude,
          enabled: settings.enabled,
        }
  sendJson(response, 200, { attachments: mask(both.attachments), default: mask(both.default) })
}

async function writeConfig(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request)
  if (body === undefined) return sendJson(response, 400, { code: 'bad_request', detail: '请求无法读取' })
  const attachments = body.attachments as BucketInput | undefined
  const fallback = body.default as BucketInput | undefined
  if (attachments === undefined || fallback === undefined) {
    return sendJson(response, 400, { code: 'bad_request', detail: '需要同时配置 attachments 与 default 两个桶' })
  }
  for (const [role, input] of [['attachments', attachments], ['default', fallback]] as const) {
    const problem = validateInput(role, input)
    if (problem !== undefined) return sendJson(response, 400, { code: 'invalid_config', detail: `${role}: ${problem}` })
    const existing = await loadBucket(ctx.database.pool, ctx.secrets, role)
    const secretId = (input.secretId ?? '').trim() === '' ? existing?.secretId : input.secretId
    const secretKey = (input.secretKey ?? '').trim() === '' ? existing?.secretKey : input.secretKey
    if (secretId === undefined || secretId === '') {
      return sendJson(response, 400, { code: 'invalid_config', detail: `${role}: SecretId 不能为空` })
    }
    if (secretKey === undefined || secretKey === '') {
      return sendJson(response, 400, { code: 'invalid_config', detail: `${role}: SecretKey 不能为空` })
    }
    const probe = {
      role,
      bucket: input.bucket!.trim(),
      region: input.region!.trim(),
      secretId: secretId.trim(),
      secretKey,
      basePrefix: input.basePrefix ?? '',
      maxUploadBytes: input.maxUploadBytes ?? 104_857_600,
      maxPreviewBytes: input.maxPreviewBytes ?? 20_971_520,
      maxArchiveBytes: input.maxArchiveBytes ?? 1_073_741_824,
      archiveExclude: input.archiveExclude ?? DEFAULT_ARCHIVE_EXCLUDE,
      enabled: input.enabled !== false,
    }
    try {
      await invoke(createClient(probe), 'getBucket', { Bucket: probe.bucket, Region: probe.region, MaxKeys: 1 })
    } catch (cause) {
      const mapped = mapError(cause)
      return sendJson(response, 400, { code: 'config_test_failed', detail: `${role}: ${mapped.detail}`, role })
    }
  }
  await saveBucket(ctx.database.pool, ctx.secrets, 'attachments', attachments)
  await saveBucket(ctx.database.pool, ctx.secrets, 'default', fallback)
  await recordAudit(ctx.database.pool, {
    sessionId: null,
    actor: 'console',
    action: 'config',
    objectKey: '',
    sizeBytes: null,
    ok: true,
    error: null,
    detail: { roles: ['attachments', 'default'] },
  })
  await readConfig(ctx, response)
}

async function removeConfig(ctx: HostCtx, response: ServerResponse): Promise<void> {
  await clearBuckets(ctx.database.pool)
  await recordAudit(ctx.database.pool, {
    sessionId: null,
    actor: 'console',
    action: 'config',
    objectKey: '',
    sizeBytes: null,
    ok: true,
    error: null,
    detail: { cleared: true },
  })
  response.writeHead(204, { 'cache-control': 'no-store' })
  response.end()
}

async function testConfig(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request)
  if (body === undefined) return sendJson(response, 400, { code: 'bad_request', detail: '请求无法读取' })
  const role = body.role
  if (!isRole(role)) return sendJson(response, 400, { code: 'invalid_config', detail: 'role 必须是 attachments 或 default' })
  const input = body as BucketInput
  const existing = await loadBucket(ctx.database.pool, ctx.secrets, role)
  const secretId = (input.secretId ?? '').trim() === '' ? existing?.secretId : input.secretId?.trim()
  const secretKey = (input.secretKey ?? '').trim() === '' ? existing?.secretKey : input.secretKey
  if (secretId === undefined || secretId === '') {
    return sendJson(response, 400, { code: 'invalid_config', detail: 'SecretId 不能为空' })
  }
  if (secretKey === undefined || secretKey === '') {
    return sendJson(response, 400, { code: 'invalid_config', detail: 'SecretKey 不能为空' })
  }
  const settings = {
    role,
    bucket: (input.bucket ?? '').trim(),
    region: (input.region ?? '').trim(),
    secretId,
    secretKey,
    basePrefix: input.basePrefix ?? '',
    maxUploadBytes: input.maxUploadBytes ?? 104_857_600,
    maxPreviewBytes: input.maxPreviewBytes ?? 20_971_520,
    maxArchiveBytes: 1_073_741_824,
    archiveExclude: input.archiveExclude ?? DEFAULT_ARCHIVE_EXCLUDE,
    enabled: true,
  }
  const started = Date.now()
  try {
    await invoke(createClient(settings), 'getBucket', { Bucket: settings.bucket, Region: settings.region, MaxKeys: 1 })
    sendJson(response, 200, { ok: true, role, bucket: settings.bucket, latencyMs: Date.now() - started })
  } catch (cause) {
    const mapped = mapError(cause)
    sendJson(response, 400, { code: mapped.code, detail: mapped.detail, role })
  }
}

async function list(ctx: HostCtx, url: URL, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  try {
    const page = await listObjects(settings, createClient(settings), {
      prefix: url.searchParams.get('prefix') ?? '',
      marker: url.searchParams.get('marker') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 100) || 100,
      search: url.searchParams.get('search') ?? '',
    })
    sendJson(response, 200, page)
  } catch (cause) {
    const mapped = mapError(cause)
    sendJson(response, 502, mapped)
  }
}

async function upload(ctx: HostCtx, request: IncomingMessage, url: URL, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const key = url.searchParams.get('key') ?? ''
  if (key === '') return sendJson(response, 400, { code: 'key_invalid', detail: '缺少 key' })
  const length = Number(request.headers['content-length'] ?? '')
  if (!Number.isFinite(length) || length < 0) {
    return sendJson(response, 411, { code: 'length_required', detail: '需要 Content-Length' })
  }
  if (length > settings.maxUploadBytes) {
    return sendJson(response, 413, { code: 'upload_too_large', detail: `超过上限 ${Math.floor(settings.maxUploadBytes / 1048576)}MB` })
  }
  const client = createClient(settings)
  const overwrite = url.searchParams.get('overwrite') === 'true'
  if (!overwrite) {
    try {
      await statObject(settings, client, key)
      return sendJson(response, 409, { code: 'object_exists', detail: '对象已存在' })
    } catch (cause) {
      const mapped = mapError(cause)
      if (mapped.code !== 'object_not_found') return sendJson(response, 502, mapped)
    }
  }
  try {
    await putObject(settings, client, key, request, length, String(request.headers['content-type'] ?? 'application/octet-stream'))
    await recordAudit(ctx.database.pool, {
      sessionId: null,
      actor: 'console',
      action: 'upload',
      objectKey: sanitizeKey(key, settings.basePrefix),
      sizeBytes: length,
      ok: true,
      error: null,
      detail: {},
    })
    sendJson(response, 200, { key: sanitizeKey(key, settings.basePrefix), size: length })
  } catch (cause) {
    const mapped = mapError(cause)
    await recordAudit(ctx.database.pool, {
      sessionId: null,
      actor: 'console',
      action: 'upload',
      objectKey: key,
      sizeBytes: length,
      ok: false,
      error: mapped.detail,
      detail: {},
    })
    sendJson(response, 502, mapped)
  }
}

async function remove(ctx: HostCtx, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const key = url.searchParams.get('key') ?? ''
  if (key === '') return sendJson(response, 400, { code: 'key_invalid', detail: '缺少 key' })
  try {
    await deleteObject(settings, createClient(settings), key)
    await recordAudit(ctx.database.pool, {
      sessionId: null,
      actor: 'console',
      action: 'delete',
      objectKey: sanitizeKey(key, settings.basePrefix),
      sizeBytes: null,
      ok: true,
      error: null,
      detail: {},
    })
    response.writeHead(204, { 'cache-control': 'no-store' })
    response.end()
  } catch (cause) {
    const mapped = mapError(cause)
    await recordAudit(ctx.database.pool, {
      sessionId: null,
      actor: 'console',
      action: 'delete',
      objectKey: key,
      sizeBytes: null,
      ok: false,
      error: mapped.detail,
      detail: {},
    })
    sendJson(response, 502, mapped)
  }
}

async function download(ctx: HostCtx, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const key = url.searchParams.get('key') ?? ''
  if (key === '') return sendJson(response, 400, { code: 'key_invalid', detail: '缺少 key' })
  try {
    const name = key.split('/').pop() ?? 'download'
    const signed = await signedDownloadUrl(settings, createClient(settings), key, name)
    await recordAudit(ctx.database.pool, {
      sessionId: null,
      actor: 'console',
      action: 'download',
      objectKey: sanitizeKey(key, settings.basePrefix),
      sizeBytes: null,
      ok: true,
      error: null,
      detail: {},
    })
    response.writeHead(302, { location: signed, 'cache-control': 'no-store' })
    response.end()
  } catch (cause) {
    const mapped = mapError(cause)
    await recordAudit(ctx.database.pool, {
      sessionId: null,
      actor: 'console',
      action: 'download',
      objectKey: key,
      sizeBytes: null,
      ok: false,
      error: mapped.detail,
      detail: {},
    })
    sendJson(response, 502, mapped)
  }
}

async function raw(ctx: HostCtx, url: URL, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const key = url.searchParams.get('key') ?? ''
  if (key === '') return sendJson(response, 400, { code: 'key_invalid', detail: '缺少 key' })
  try {
    const name = key.split('/').pop() ?? 'file'
    const signed = await signedInlineUrl(settings, createClient(settings), key, name)
    response.writeHead(302, { location: signed, 'cache-control': 'no-store' })
    response.end()
  } catch (cause) {
    sendJson(response, 502, mapError(cause))
  }
}

async function text(ctx: HostCtx, url: URL, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const key = url.searchParams.get('key') ?? ''
  if (key === '') return sendJson(response, 400, { code: 'key_invalid', detail: '缺少 key' })
  try {
    const result = await readObjectText(settings, createClient(settings), key, 512 * 1024)
    sendJson(response, 200, result)
  } catch (cause) {
    const mapped = mapError(cause)
    if (cause instanceof Error && cause.message.includes('预览上限')) {
      sendJson(response, 413, { code: 'preview_too_large', detail: cause.message })
      return
    }
    sendJson(response, 502, mapped)
  }
}

async function materializeObject(ctx: HostCtx, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const settings = await requireDefault(ctx.database.pool, ctx.secrets, response)
  if (settings === undefined) return
  const body = await readJson(request)
  if (body === undefined) return sendJson(response, 400, { code: 'bad_request', detail: '请求无法读取' })
  const sessionId = String(body.sessionId ?? '')
  const key = String(body.key ?? '')
  if (sessionId === '' || key === '') return sendJson(response, 400, { code: 'key_invalid', detail: '需要 sessionId 与 key' })
  try {
    const result = await materialize(ctx, settings, sessionId, key)
    await recordAudit(ctx.database.pool, {
      sessionId: null,
      actor: 'console',
      action: 'download',
      objectKey: sanitizeKey(key, settings.basePrefix),
      sizeBytes: result.size,
      ok: true,
      error: null,
      detail: { mode: 'materialize', etag: result.etag, linked: result.linked },
    })
    sendJson(response, 200, result)
  } catch (cause) {
    if (cause instanceof PreviewError) {
      const status = cause.code === 'preview_too_large' ? 413 : cause.code === 'session_not_found' ? 404 : 400
      sendJson(response, status, { code: cause.code, detail: cause.message })
      return
    }
    const mapped = mapError(cause)
    sendJson(response, 502, mapped)
  }
}

async function readAudit(ctx: HostCtx, url: URL, response: ServerResponse): Promise<void> {
  const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1)
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('page_size') ?? 20) || 20, 1), 100)
  const hoursText = url.searchParams.get('hours')
  const result = await queryAudit(ctx.database.pool, {
    page,
    pageSize,
    action: url.searchParams.get('action') ?? '',
    hours: hoursText === null ? undefined : Number(hoursText),
    key: url.searchParams.get('key') ?? '',
  })
  sendJson(response, 200, result)
}

async function requireDefault(pool: Queryable, secrets: Secrets, response: ServerResponse) {
  const settings = await loadBucket(pool, secrets, 'default')
  if (settings === undefined) {
    sendJson(response, 400, { code: 'cos_role_not_configured', detail: '默认桶尚未配置' })
    return undefined
  }
  if (!settings.enabled) {
    sendJson(response, 400, { code: 'cos_disabled', detail: '默认桶已被禁用' })
    return undefined
  }
  return settings
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(text)
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        resolve(undefined)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined)
      } catch {
        resolve(undefined)
      }
    })
    request.on('error', () => resolve(undefined))
  })
}

function cookieHeader(request: IncomingMessage): string {
  return request.headers.cookie ?? ''
}
