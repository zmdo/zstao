import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { BucketSettings } from './config.ts'
import { mapError, sanitizeKey, toRequestError, type CosClient } from './cos.ts'
import { copyObject, contentTypeOf, deleteObject, listPrefixEntries, putObject, statObject } from './objects.ts'

/** One synchronous batch is capped so a tool call stays inside its timeout. */
export const BATCH_MAX_ITEMS = 200
export const BATCH_MAX_UPLOADS = 100
export const BATCH_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
export const BATCH_MAX_COPY_BYTES = 5 * 1024 * 1024 * 1024

const HEAD_CONCURRENCY = 16
const RUN_CONCURRENCY = 6
const RETRY_ATTEMPTS = 3

export type ConflictPolicy = 'fail' | 'skip' | 'overwrite'
export type ErrorPolicy = 'continue' | 'stop'
export type BatchOpName = 'move' | 'copy' | 'delete' | 'upload'
export type ItemStatus = 'ok' | 'skipped_conflict' | 'skipped_missing' | 'copied_source_kept' | 'failed' | 'cancelled'

/** Input shape accepted from the tool/HTTP layer; `absolutePath` is resolved by the tool. */
export interface BatchOpInput {
  op?: unknown
  from?: unknown
  to?: unknown
  key?: unknown
  path?: unknown
  recursive?: unknown
  overwrite?: unknown
  absolutePath?: string
}

export interface BatchOptions {
  onConflict: ConflictPolicy
  onError: ErrorPolicy
}

export interface PlannedItem {
  index: number
  op: BatchOpName
  from?: string
  to?: string
  key?: string
  path?: string
  absolutePath?: string
  size: number | null
  sourceEtag?: string
  destExists: boolean
  missing: boolean
  overwrite?: boolean
}

export interface PlanSummary {
  requested: number
  items: number
  move: number
  copy: number
  delete: number
  upload: number
  bytes: number
  conflicts: number
  missing: number
}

export interface BatchPlan {
  planId: string
  items: PlannedItem[]
  summary: PlanSummary
  sample: Array<Record<string, unknown>>
  options: { onConflict: ConflictPolicy; onError: ErrorPolicy }
  warnings: string[]
}

export type CompileResult =
  | { ok: true; plan: BatchPlan }
  | { ok: false; code: string; detail: string; problems: string[] }

export interface ItemResult {
  index: number
  op: BatchOpName
  from?: string
  to?: string
  key?: string
  path?: string
  ok: boolean
  status: ItemStatus
  code?: string
  detail?: string
  size: number | null
}

export interface RunSummary {
  total: number
  succeeded: number
  failed: number
  skipped: number
  sourceKept: number
  cancelled: number
  bytes: number
}

export interface BatchOutcome {
  batchId: string
  status: 'completed' | 'partial' | 'failed'
  summary: RunSummary
  items: ItemResult[]
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const normalizeEtag = (value: string | undefined): string => (value ?? '').replace(/^"|"$/g, '')
const comparableEtag = (value: string | undefined): boolean => {
  const etag = normalizeEtag(value)
  return etag !== '' && !etag.includes('-')
}

function isNotFound(cause: unknown): boolean {
  const error = cause as { statusCode?: number; code?: string; error?: { Code?: string } }
  return error?.statusCode === 404 || error?.code === 'NoSuchKey' || error?.error?.Code === 'NoSuchKey'
}

function retryable(cause: unknown): boolean {
  const status = toRequestError(cause).statusCode
  return status === undefined || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function retry<T>(run: () => Promise<T>, attempts = RETRY_ATTEMPTS): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run()
    } catch (cause) {
      last = cause
      if (!retryable(cause) || attempt === attempts - 1) throw cause
      await sleep(200 * 2 ** attempt + Math.floor(Math.random() * 100))
    }
  }
  throw last
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function checkKey(value: string, label: string, problems: string[]): boolean {
  try {
    sanitizeKey(value, '')
    return true
  } catch (cause) {
    problems.push(`${label}: ${messageOf(cause)}`)
    return false
  }
}

async function destinationExists(settings: BucketSettings, client: CosClient, key: string): Promise<boolean> {
  try {
    await statObject(settings, client, key)
    return true
  } catch (cause) {
    if (isNotFound(cause)) return false
    throw cause
  }
}

function conflictPolicy(plan: BatchPlan, item: PlannedItem): ConflictPolicy {
  if (item.overwrite === true) return 'overwrite'
  if (item.overwrite === false) return 'fail'
  return plan.options.onConflict
}

/**
 * Expand and validate a batch without touching objects. Structural problems
 * fail the whole plan; missing sources and destination conflicts are reported
 * in the summary and still validated again while running.
 */
export async function compileBatch(
  settings: BucketSettings,
  client: CosClient,
  inputs: readonly BatchOpInput[],
  options: BatchOptions,
): Promise<CompileResult> {
  const problems: string[] = []
  const items: PlannedItem[] = []
  let requested = 0

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { ok: false, code: 'batch_empty', detail: 'ops 不能为空', problems: [] }
  }
  if (inputs.length > BATCH_MAX_ITEMS) {
    return { ok: false, code: 'batch_too_large', detail: `单批最多 ${BATCH_MAX_ITEMS} 个操作`, problems: [] }
  }

  const push = (item: Omit<PlannedItem, 'index' | 'destExists' | 'missing'>): boolean => {
    if (items.length >= BATCH_MAX_ITEMS) {
      problems.push(`单批最多 ${BATCH_MAX_ITEMS} 个对象，请拆分批次`)
      return false
    }
    items.push({ ...item, index: items.length, destExists: false, missing: false })
    return true
  }

  for (const [position, raw] of inputs.entries()) {
    requested += 1
    if (raw === null || typeof raw !== 'object') {
      problems.push(`ops[${position}]: 不是对象`)
      continue
    }
    if (raw.recursive !== undefined && typeof raw.recursive !== 'boolean') {
      problems.push(`ops[${position}].recursive: 必须是布尔值`)
      continue
    }
    let overwrite: boolean | undefined
    if (raw.overwrite !== undefined) {
      if (typeof raw.overwrite !== 'boolean') {
        problems.push(`ops[${position}].overwrite: 必须是布尔值`)
        continue
      }
      overwrite = raw.overwrite
    }

    const op = textOf(raw.op)
    if (op === 'move' || op === 'copy') {
      const from = textOf(raw.from)
      const to = textOf(raw.to)
      const recursive = raw.recursive === true
      if (from === '' || to === '') {
        problems.push(`ops[${position}]: ${op} 需要 from 和 to`)
        continue
      }
      if (!checkKey(from, `ops[${position}].from`, problems)) continue
      if (!checkKey(to, `ops[${position}].to`, problems)) continue
      if (recursive) {
        if (!from.endsWith('/')) {
          problems.push(`ops[${position}]: 目录操作需要 from 以 / 结尾`)
          continue
        }
        const toPrefix = to.endsWith('/') ? to : `${to}/`
        if (toPrefix === from || toPrefix.startsWith(from)) {
          problems.push(`ops[${position}]: 目标前缀不能位于源前缀内`)
          continue
        }
        const remaining = BATCH_MAX_ITEMS - items.length
        if (remaining <= 0) {
          problems.push(`ops[${position}]: 超出单批上限 ${BATCH_MAX_ITEMS}`)
          continue
        }
        let listed
        try {
          listed = await listPrefixEntries(settings, client, from, remaining)
        } catch (cause) {
          problems.push(`ops[${position}].from: ${mapError(cause).detail}`)
          continue
        }
        if (listed.truncated) {
          problems.push(`ops[${position}]: 源前缀内对象超过单批上限 ${BATCH_MAX_ITEMS}`)
          continue
        }
        if (listed.items.length === 0) {
          problems.push(`ops[${position}]: 源前缀下没有对象`)
          continue
        }
        for (const entry of listed.items) {
          if (!push({ op, from: entry.key, to: `${toPrefix}${entry.key.slice(from.length)}`, size: entry.size, overwrite })) break
        }
      } else {
        if (from.endsWith('/')) {
          problems.push(`ops[${position}]: 目录操作需要 recursive:true`)
          continue
        }
        if (from === to) {
          problems.push(`ops[${position}]: 源和目标不能相同`)
          continue
        }
        push({ op, from, to, size: null, overwrite })
      }
      continue
    }

    if (op === 'delete') {
      const key = textOf(raw.key)
      if (key === '') {
        problems.push(`ops[${position}]: delete 需要 key`)
        continue
      }
      if (!checkKey(key, `ops[${position}].key`, problems)) continue
      push({ op, key, size: null })
      continue
    }

    if (op === 'upload') {
      const key = textOf(raw.key)
      const path = textOf(raw.path)
      const absolutePath = textOf(raw.absolutePath)
      if (key === '' || absolutePath === '') {
        problems.push(`ops[${position}]: upload 需要工作区路径和 key`)
        continue
      }
      if (!checkKey(key, `ops[${position}].key`, problems)) continue
      let info
      try {
        info = await stat(absolutePath)
      } catch {
        problems.push(`ops[${position}].path: 工作区内没有这个文件`)
        continue
      }
      if (!info.isFile()) {
        problems.push(`ops[${position}].path: 不是文件`)
        continue
      }
      if (info.size > settings.maxUploadBytes) {
        problems.push(`ops[${position}]: 文件超过上传上限 ${Math.floor(settings.maxUploadBytes / 1048576)}MB`)
        continue
      }
      push({ op, key, path: path === '' ? undefined : path, absolutePath, size: info.size, overwrite })
      continue
    }

    problems.push(`ops[${position}].op: 不支持的操作 ${op === '' ? '(空)' : op}`)
  }

  if (problems.length > 0) {
    return { ok: false, code: 'invalid_batch', detail: '批量参数有误', problems }
  }

  const uploads = items.filter((item) => item.op === 'upload')
  if (uploads.length > BATCH_MAX_UPLOADS) {
    return { ok: false, code: 'batch_too_large', detail: `单批最多上传 ${BATCH_MAX_UPLOADS} 个文件`, problems: [] }
  }
  const uploadBytes = uploads.reduce((total, item) => total + (item.size ?? 0), 0)
  if (uploadBytes > BATCH_MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'batch_too_large', detail: '单批上传总量超过 2GB', problems: [] }
  }

  await mapLimit(items, HEAD_CONCURRENCY, async (item) => {
    try {
      if (item.op === 'move' || item.op === 'copy') {
        if (item.size === null) {
          try {
            const info = await statObject(settings, client, item.from as string)
            item.size = info.size
            item.sourceEtag = normalizeEtag(info.etag)
          } catch (cause) {
            if (isNotFound(cause)) {
              item.missing = true
              return
            }
            throw cause
          }
        }
        item.destExists = await destinationExists(settings, client, item.to as string)
      } else if (item.op === 'upload') {
        item.destExists = await destinationExists(settings, client, item.key as string)
      }
    } catch (cause) {
      problems.push(`${item.op} ${item.from ?? item.key ?? ''}: ${mapError(cause).detail}`)
    }
  })

  if (problems.length > 0) {
    return { ok: false, code: 'invalid_batch', detail: '批量参数有误', problems }
  }

  const summary: PlanSummary = {
    requested,
    items: items.length,
    move: items.filter((item) => item.op === 'move').length,
    copy: items.filter((item) => item.op === 'copy').length,
    delete: items.filter((item) => item.op === 'delete').length,
    upload: uploads.length,
    bytes: items.reduce((total, item) => total + (item.size ?? 0), 0),
    conflicts: items.filter((item) => item.destExists).length,
    missing: items.filter((item) => item.missing).length,
  }
  const sample = items.slice(0, 20).map((item) => ({
    op: item.op,
    from: item.from ?? null,
    to: item.to ?? null,
    key: item.key ?? null,
    size: item.size,
    conflict: item.destExists,
    missing: item.missing,
  }))

  return {
    ok: true,
    plan: {
      planId: randomUUID(),
      items,
      summary,
      sample,
      options: { onConflict: options.onConflict, onError: options.onError },
      warnings: [],
    },
  }
}

function itemResult(item: PlannedItem, status: ItemStatus, code?: string, detail?: string, size?: number | null): ItemResult {
  return {
    index: item.index,
    op: item.op,
    from: item.from,
    to: item.to,
    key: item.key,
    path: item.path,
    ok: status === 'ok',
    status,
    code,
    detail,
    size: size === undefined ? item.size : size,
  }
}

function failed(item: PlannedItem, cause: unknown, code?: string, size?: number | null): ItemResult {
  if (code !== undefined) return itemResult(item, 'failed', code, undefined, size)
  const mapped = mapError(cause)
  return itemResult(item, 'failed', mapped.code, mapped.detail, size)
}

async function runCopy(settings: BucketSettings, client: CosClient, plan: BatchPlan, item: PlannedItem): Promise<ItemResult> {
  const from = item.from as string
  const to = item.to as string
  let source: { size: number; etag: string }
  try {
    source = await retry(() => statObject(settings, client, from))
  } catch (cause) {
    if (isNotFound(cause)) return itemResult(item, 'failed', 'source_not_found', '源对象不存在')
    return failed(item, cause)
  }
  const sourceEtag = normalizeEtag(source.etag)
  if (item.sourceEtag !== undefined && sourceEtag !== '' && item.sourceEtag !== sourceEtag) {
    return itemResult(item, 'failed', 'source_changed', '源对象在计划后发生变化', source.size)
  }
  if (source.size > BATCH_MAX_COPY_BYTES) {
    return itemResult(item, 'failed', 'copy_too_large', '对象超过 5GB，暂不支持批量复制', source.size)
  }

  let exists: boolean
  try {
    exists = await destinationExists(settings, client, to)
  } catch (cause) {
    return failed(item, cause)
  }
  const policy = conflictPolicy(plan, item)
  if (exists && policy !== 'overwrite') {
    if (policy === 'skip') return itemResult(item, 'skipped_conflict', 'destination_exists', '目标已存在，已跳过', source.size)
    return itemResult(item, 'failed', 'destination_exists', '目标已存在', source.size)
  }

  try {
    await retry(() => copyObject(settings, client, from, to))
  } catch (cause) {
    return failed(item, cause, undefined, source.size)
  }

  let copied: { size: number; etag: string }
  try {
    copied = await retry(() => statObject(settings, client, to))
  } catch (cause) {
    const mapped = mapError(cause)
    return itemResult(item, 'failed', 'copy_verify_failed', `目标校验失败：${mapped.detail}`, source.size)
  }
  if (copied.size !== source.size) {
    return itemResult(item, 'failed', 'copy_verify_failed', `目标大小 ${copied.size} 与源 ${source.size} 不一致`, source.size)
  }
  if (comparableEtag(source.etag) && comparableEtag(copied.etag) && normalizeEtag(source.etag) !== normalizeEtag(copied.etag)) {
    return itemResult(item, 'failed', 'copy_verify_failed', '目标 ETag 与源不一致', source.size)
  }

  if (item.op === 'copy') return itemResult(item, 'ok', undefined, undefined, source.size)

  try {
    await retry(() => deleteObject(settings, client, from))
  } catch (cause) {
    return itemResult(item, 'copied_source_kept', 'source_delete_failed', `已复制但删除源失败：${mapError(cause).detail}`, source.size)
  }
  return itemResult(item, 'ok', undefined, undefined, source.size)
}

async function runDelete(settings: BucketSettings, client: CosClient, item: PlannedItem): Promise<ItemResult> {
  const key = item.key as string
  try {
    await retry(() => deleteObject(settings, client, key))
    return itemResult(item, 'ok', undefined, undefined, item.size)
  } catch (cause) {
    if (isNotFound(cause)) return itemResult(item, 'skipped_missing', 'object_not_found', '对象不存在，已视为删除', item.size)
    return failed(item, cause, undefined, item.size)
  }
}

async function runUpload(settings: BucketSettings, client: CosClient, plan: BatchPlan, item: PlannedItem): Promise<ItemResult> {
  const path = item.absolutePath as string
  const key = item.key as string
  if (path === undefined || path === '') return itemResult(item, 'failed', 'upload_path_missing', '缺少上传文件路径')

  let info
  try {
    info = await stat(path)
  } catch {
    return itemResult(item, 'failed', 'file_not_found', '工作区内没有这个文件')
  }
  if (!info.isFile()) return itemResult(item, 'failed', 'file_not_found', '路径不是文件')
  if (item.size !== null && info.size !== item.size) {
    return itemResult(item, 'failed', 'file_changed', '文件在计划后发生变化', info.size)
  }
  if (info.size > settings.maxUploadBytes) {
    return itemResult(item, 'failed', 'upload_too_large', `文件超过上限 ${Math.floor(settings.maxUploadBytes / 1048576)}MB`, info.size)
  }

  let exists: boolean
  try {
    exists = await destinationExists(settings, client, key)
  } catch (cause) {
    return failed(item, cause, undefined, info.size)
  }
  const policy = conflictPolicy(plan, item)
  if (exists && policy !== 'overwrite') {
    if (policy === 'skip') return itemResult(item, 'skipped_conflict', 'destination_exists', '目标已存在，已跳过', info.size)
    return itemResult(item, 'failed', 'destination_exists', '目标已存在', info.size)
  }

  try {
    await retry(() => putObject(settings, client, key, createReadStream(path), info.size, contentTypeOf(path)))
  } catch (cause) {
    return failed(item, cause, undefined, info.size)
  }

  try {
    const uploaded = await retry(() => statObject(settings, client, key))
    if (uploaded.size !== info.size) {
      return itemResult(item, 'failed', 'upload_verify_failed', `目标大小 ${uploaded.size} 与本地 ${info.size} 不一致`, info.size)
    }
  } catch (cause) {
    const mapped = mapError(cause)
    return itemResult(item, 'failed', 'upload_verify_failed', `目标校验失败：${mapped.detail}`, info.size)
  }
  return itemResult(item, 'ok', undefined, undefined, info.size)
}

async function runItem(settings: BucketSettings, client: CosClient, plan: BatchPlan, item: PlannedItem): Promise<ItemResult> {
  try {
    if (item.op === 'delete') return await runDelete(settings, client, item)
    if (item.op === 'upload') return await runUpload(settings, client, plan, item)
    return await runCopy(settings, client, plan, item)
  } catch (cause) {
    return failed(item, cause)
  }
}

/** Run a compiled plan with bounded concurrency and per-item results. */
export async function executeBatch(
  settings: BucketSettings,
  client: CosClient,
  plan: BatchPlan,
  concurrency = RUN_CONCURRENCY,
): Promise<BatchOutcome> {
  let stopped = false
  const items = await mapLimit(plan.items, concurrency, async (item) => {
    if (stopped) return itemResult(item, 'cancelled', 'stopped', '前序操作失败后停止')
    const result = await runItem(settings, client, plan, item)
    if ((result.status === 'failed' || result.status === 'copied_source_kept') && plan.options.onError === 'stop') stopped = true
    return result
  })

  const summary: RunSummary = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    sourceKept: 0,
    cancelled: 0,
    bytes: 0,
  }
  for (const item of items) {
    if (item.status === 'ok') {
      summary.succeeded += 1
      summary.bytes += item.size ?? 0
    } else if (item.status === 'copied_source_kept') {
      summary.sourceKept += 1
    } else if (item.status === 'failed') {
      summary.failed += 1
    } else if (item.status === 'cancelled') {
      summary.cancelled += 1
    } else {
      summary.skipped += 1
    }
  }
  const bad = summary.failed + summary.sourceKept
  const status: BatchOutcome['status'] = bad === 0 && summary.cancelled === 0 ? 'completed' : summary.succeeded === 0 ? 'failed' : 'partial'
  return { batchId: plan.planId, status, summary, items }
}
