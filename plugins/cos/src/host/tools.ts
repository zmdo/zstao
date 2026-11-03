import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { authorizeOperation, sessionPermission } from './approval.ts'
import { recordAudit } from './audit.ts'
import { compileBatch, executeBatch, type BatchOpInput } from './batch.ts'
import { recordBatchAudit } from './batch-audit.ts'
import { createClient, invoke, mapError, sanitizeKey, type CosClient } from './cos.ts'
import { loadBucket, type BucketSettings, type Queryable, type Secrets } from './config.ts'
import { contentTypeOf, deleteObject, listObjects, signedDownloadUrl, statObject } from './objects.ts'
import { materialize, PreviewError } from './preview.ts'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

export interface ToolDeps {
  pool: Queryable
  secrets: Secrets
}

interface ExecLike {
  agent?: { id?: string; session?: unknown }
  callId?: string
  signal: AbortSignal
}

interface WorkingDirectoryLike {
  ensure(agent: unknown, signal?: AbortSignal): Promise<string>
}

const fail = (code: string, detail: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ error: { code, detail, ...extra } })

const isNotFound = (cause: unknown): boolean => {
  const error = cause as { statusCode?: number; code?: string; error?: { Code?: string } }
  return error?.statusCode === 404 || error?.code === 'NoSuchKey' || error?.error?.Code === 'NoSuchKey'
}

const defaultBucket = async (deps: ToolDeps): Promise<{ settings: BucketSettings } | { error: string }> => {
  const settings = await loadBucket(deps.pool, deps.secrets, 'default')
  if (settings === undefined) return { error: fail('cos_role_not_configured', '默认桶尚未配置') }
  if (!settings.enabled) return { error: fail('cos_disabled', '默认桶已被禁用') }
  return { settings }
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function registerCosTools(scope: Context, deps: ToolDeps): void {
  const audit = async (
    exec: ExecLike,
    action: 'upload' | 'download' | 'delete',
    key: string,
    size: number | null,
    ok: boolean,
    error: string | null,
    detail: Record<string, unknown>,
  ): Promise<void> => {
    await recordAudit(deps.pool, {
      sessionId: exec.agent?.id ?? null,
      actor: 'tool',
      action,
      objectKey: key,
      sizeBytes: size,
      ok,
      error,
      detail,
    }).catch(() => undefined)
  }

  const approve = (exec: ExecLike, tool: string, reason: string, displayReason: string) =>
    authorizeOperation(
      scope,
      {
        agent: exec.agent,
        callId: String(exec.callId),
        signal: exec.signal,
        permission: sessionPermission(scope, exec.agent),
      },
      () => ({ toolName: tool, kind: 'cos_object', reason, displayReason }),
    )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_list',
      description: 'List files and folders in the default COS bucket. Use search to match names within the prefix.',
      parameters: {
        prefix: { type: 'string', description: 'Folder prefix relative to the configured root, for example docs/.' },
        search: { type: 'string', description: 'Optional case-insensitive name filter.' },
        limit: { type: 'integer', description: 'Maximum entries, 1-100. Defaults to 50.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args: Record<string, unknown>) {
        const target = await defaultBucket(deps)
        if ('error' in target) return target.error
        try {
          const client: CosClient = createClient(target.settings)
          const page = await listObjects(target.settings, client, {
            prefix: String(args.prefix ?? ''),
            marker: '',
            limit: Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 100),
            search: String(args.search ?? ''),
          })
          return JSON.stringify({
            prefix: String(args.prefix ?? ''),
            items: page.items.map((item) => ({ kind: item.kind, key: item.key, name: item.name, size: item.size, updated: item.lastModified })),
            truncated: page.truncated,
          })
        } catch (cause) {
          return fail(mapError(cause).code, mapError(cause).detail)
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_get',
      description: 'Return metadata and a 300-second signed download URL for one object in the default bucket.',
      parameters: { key: { type: 'string', required: true, description: 'Object key relative to the configured root.' } },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const target = await defaultBucket(deps)
        if ('error' in target) return target.error
        const key = String(args.key ?? '')
        try {
          const client = createClient(target.settings)
          const stat = await statObject(target.settings, client, key)
          const url = await signedDownloadUrl(target.settings, client, key, key.split('/').pop() ?? key)
          await audit(exec, 'download', key, stat.size, true, null, { via: 'tool' })
          return JSON.stringify({ key: sanitizeKey(key, target.settings.basePrefix), size: stat.size, url, expiresIn: 300 })
        } catch (cause) {
          const mapped = mapError(cause)
          await audit(exec, 'download', key, null, false, mapped.detail, { via: 'tool' })
          return fail(mapped.code, mapped.detail)
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_upload',
      description:
        'Upload one file from the session workspace into the default bucket. The user approves the change unless the session has full access.',
      parameters: {
        path: { type: 'string', required: true, description: 'Workspace-relative or absolute path of the file to upload.' },
        key: { type: 'string', required: true, description: 'Destination object key relative to the configured root.' },
        overwrite: { type: 'boolean', description: 'Overwrite an existing object. Defaults to false.' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 300_000,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const target = await defaultBucket(deps)
        if ('error' in target) return target.error
        const workingDirectory = scope.get('workingDirectory') as WorkingDirectoryLike | undefined
        if (workingDirectory === undefined) return fail('workspace_unavailable', '当前会话没有工作区')
        const key = String(args.key ?? '')
        let absolute: string
        try {
          const root = await workingDirectory.ensure(exec.agent, exec.signal)
          const candidate = resolve(root, String(args.path ?? ''))
          if (candidate !== root && !candidate.startsWith(root + sep)) return fail('path_outside_workspace', '只能上传工作区内的文件')
          absolute = candidate
        } catch (cause) {
          return fail('workspace_unavailable', cause instanceof Error ? cause.message : String(cause))
        }
        let info
        try {
          info = await stat(absolute)
        } catch {
          return fail('file_not_found', '工作区内没有这个文件')
        }
        if (!info.isFile()) return fail('file_not_found', '路径不是文件')
        if (info.size > target.settings.maxUploadBytes) {
          return fail('upload_too_large', `文件超过上限 ${Math.floor(target.settings.maxUploadBytes / 1048576)}MB`)
        }
        const overwrite = args.overwrite === true
        const client = createClient(target.settings)
        if (!overwrite) {
          try {
            await statObject(target.settings, client, key)
            return fail('object_exists', '目标已存在；如需覆盖请传 overwrite=true')
          } catch (cause) {
            if (!isNotFound(cause)) return fail(mapError(cause).code, mapError(cause).detail)
          }
        }
        const decision = await approve(
          exec,
          'platform_cos_upload',
          `Upload ${relative(absolute, process.cwd())} to ${key}`,
          `上传 ${absolute.split(sep).pop()} 到 ${key}`,
        )
        if (!decision.allowed) return fail('approval_denied', `未获批准（${decision.outcome}）`, { outcome: decision.outcome })
        try {
          await invoke(client, 'putObject', {
            Bucket: target.settings.bucket,
            Region: target.settings.region,
            Key: sanitizeKey(key, target.settings.basePrefix),
            Body: createReadStream(absolute),
            ContentLength: info.size,
            ContentType: contentTypeOf(absolute),
          })
          await audit(exec, 'upload', key, info.size, true, null, { path: absolute })
          return JSON.stringify({ key: sanitizeKey(key, target.settings.basePrefix), size: info.size })
        } catch (cause) {
          const mapped = mapError(cause)
          await audit(exec, 'upload', key, info.size, false, mapped.detail, { path: absolute })
          return fail(mapped.code, mapped.detail)
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_delete',
      description: 'Delete one object from the default bucket. The user approves the change unless the session has full access.',
      parameters: {
        key: { type: 'string', required: true, description: 'Object key relative to the configured root.' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 120_000,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const target = await defaultBucket(deps)
        if ('error' in target) return target.error
        const key = String(args.key ?? '')
        const decision = await approve(exec, 'platform_cos_delete', `Delete ${key}`, `删除 ${key}`)
        if (!decision.allowed) return fail('approval_denied', `未获批准（${decision.outcome}）`, { outcome: decision.outcome })
        try {
          await deleteObject(target.settings, createClient(target.settings), key)
          await audit(exec, 'delete', key, null, true, null, {})
          return JSON.stringify({ deleted: key })
        } catch (cause) {
          const mapped = mapError(cause)
          await audit(exec, 'delete', key, null, false, mapped.detail, {})
          return fail(mapped.code, mapped.detail)
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_materialize',
      description:
        'Download one default-bucket object into the session workspace cache and return its workspace-relative path, so read/grep can open it.',
      parameters: { key: { type: 'string', required: true, description: 'Object key relative to the configured root.' } },
      output: TEXT_OUTPUT,
      timeoutMs: 300_000,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const target = await defaultBucket(deps)
        if ('error' in target) return target.error
        if (exec.agent?.id === undefined) return fail('session_not_found', '当前会话不可用')
        try {
          const result = await materialize(scope, target.settings, String(exec.agent.id), String(args.key ?? ''))
          return JSON.stringify({ path: result.path, size: result.size, etag: result.etag, linked: result.linked, readonly: true })
        } catch (cause) {
          if (cause instanceof PreviewError) return fail(cause.code, cause.message)
          return fail(mapError(cause).code, mapError(cause).detail)
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_read',
      description: 'Read a small text object from the default bucket and return its content.',
      parameters: {
        key: { type: 'string', required: true, description: 'Object key relative to the configured root.' },
        max_bytes: { type: 'integer', description: 'Maximum bytes to read, capped at 64KB and the preview limit.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args: Record<string, unknown>) {
        const target = await defaultBucket(deps)
        if ('error' in target) return target.error
        const limit = Math.min(Number(args.max_bytes ?? 65_536), 65_536, target.settings.maxPreviewBytes)
        try {
          const client = createClient(target.settings)
          const stat = await statObject(target.settings, client, String(args.key ?? ''))
          if (stat.size > limit) return fail('preview_too_large', `文件 ${stat.size} 字节，超过读取上限 ${limit}`)
          const data = await invoke(client, 'getObject', {
            Bucket: target.settings.bucket,
            Region: target.settings.region,
            Key: sanitizeKey(String(args.key ?? ''), target.settings.basePrefix),
          })
          const body = Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body)
          const text = body.toString('utf8')
          if (text.includes('\u0000')) return fail('unsupported_preview', '二进制文件不支持读取')
          return text
        } catch (cause) {
          const mapped = mapError(cause)
          return fail(mapped.code, mapped.detail)
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_audit_list',
      description: 'List recent COS operations with their result and failure reasons.',
      parameters: {
        key: { type: 'string', description: 'Optional object key substring.' },
        action: { type: 'string', enum: ['config', 'upload', 'download', 'delete', 'move', 'copy', 'batch'], description: 'Optional action filter.' },
        hours: { type: 'integer', description: 'Only records newer than this many hours.' },
        limit: { type: 'integer', description: 'Maximum records, 1-100. Defaults to 20.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args: Record<string, unknown>) {
        const { queryAudit } = await import('./audit.ts')
        const page = await queryAudit(deps.pool, {
          page: 1,
          pageSize: Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100),
          action: String(args.action ?? ''),
          hours: args.hours === undefined ? undefined : Number(args.hours),
          key: String(args.key ?? ''),
        })
        return JSON.stringify({
          count: page.items.length,
          items: page.items.map((item) => ({
            time: item.createdAt,
            actor: item.actor,
            action: item.action,
            key: item.objectKey,
            ok: item.ok,
            error: item.error,
          })),
        })
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_cos_batch',
      description:
        'Run a batch of COS operations against the default bucket: move, copy, delete and upload. A folder move/copy needs recursive=true and a from ending with /. A move is copy + verify + delete, so the source is kept when deleting it fails. The default on_conflict is fail; pass overwrite per operation to override. Writes need one user approval unless the session has full access; dry_run previews counts, conflicts and a sample without changing anything. Capped at 200 objects, 100 uploads and 2GB of uploads per call.',
      parameters: {
        ops: {
          type: 'array',
          required: true,
          description:
            'Operations. move/copy use from and to (to is the new key or prefix); delete uses key; upload uses path (a file inside the session workspace) and key. Set recursive=true to expand a from prefix ending with /.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              op: { type: 'string', enum: ['move', 'copy', 'delete', 'upload'], required: true, description: 'Operation name.' },
              from: { type: 'string', description: 'Source key or prefix for move/copy.' },
              to: { type: 'string', description: 'Destination key or prefix for move/copy.' },
              key: { type: 'string', description: 'Object key for delete/upload.' },
              path: { type: 'string', description: 'Workspace-relative or absolute file path for upload.' },
              recursive: { type: 'boolean', description: 'Expand from as a prefix; from must end with /.' },
              overwrite: { type: 'boolean', description: 'true overwrites, false fails on conflict; omitted follows on_conflict.' },
            },
          },
        },
        dry_run: { type: 'boolean', description: 'Preview the plan without asking for approval or changing anything.' },
        on_conflict: { type: 'string', enum: ['fail', 'skip', 'overwrite'], description: 'Default destination conflict policy. Defaults to fail.' },
        on_error: { type: 'string', enum: ['continue', 'stop'], description: 'Continue after a failed item or stop scheduling. Defaults to continue.' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 300_000,
      isConcurrencySafe: () => false,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const target = await defaultBucket(deps)
        if ('error' in target) return target.error
        const inputs = Array.isArray(args.ops) ? (args.ops as BatchOpInput[]) : []
        const uploads = inputs.filter((input) => input !== null && typeof input === 'object' && textOf(input.op) === 'upload')
        if (uploads.length > 0) {
          const workingDirectory = scope.get('workingDirectory') as WorkingDirectoryLike | undefined
          if (workingDirectory === undefined) return fail('workspace_unavailable', '当前会话没有工作区')
          let root: string
          try {
            root = await workingDirectory.ensure(exec.agent, exec.signal)
          } catch (cause) {
            return fail('workspace_unavailable', cause instanceof Error ? cause.message : String(cause))
          }
          for (const input of uploads) {
            const candidate = resolve(root, String(input.path ?? ''))
            if (candidate !== root && !candidate.startsWith(root + sep)) return fail('path_outside_workspace', '只能上传工作区内的文件')
            input.absolutePath = candidate
          }
        }

        const onConflict = args.on_conflict === 'skip' || args.on_conflict === 'overwrite' ? args.on_conflict : 'fail'
        const onError = args.on_error === 'stop' ? 'stop' : 'continue'
        const client = createClient(target.settings)
        const compiled = await compileBatch(target.settings, client, inputs, { onConflict, onError })
        if (!compiled.ok) return fail(compiled.code, compiled.detail, { problems: compiled.problems })
        if (args.dry_run === true) {
          return JSON.stringify({
            dryRun: true,
            planId: compiled.plan.planId,
            summary: compiled.plan.summary,
            sample: compiled.plan.sample,
            warnings: compiled.plan.warnings,
          })
        }

        const plan = compiled.plan
        const summary = plan.summary
        const reason = `COS batch: move ${summary.move}, copy ${summary.copy}, delete ${summary.delete}, upload ${summary.upload} (${formatBytes(summary.bytes)}), ${summary.conflicts} conflicts`
        const displayReason = `COS 批量操作：移动 ${summary.move}，复制 ${summary.copy}，删除 ${summary.delete}，上传 ${summary.upload}，共 ${formatBytes(summary.bytes)}`
        const decision = await approve(exec, 'platform_cos_batch', reason, displayReason)
        if (!decision.allowed) return fail('approval_denied', `未获批准（${decision.outcome}）`, { outcome: decision.outcome })

        const outcome = await executeBatch(target.settings, client, plan)
        await recordBatchAudit(deps.pool, {
          actor: 'tool',
          sessionId: exec.agent?.id ?? null,
          plan,
          outcome,
        })
        return JSON.stringify(outcome)
      },
    }),
  )
}
