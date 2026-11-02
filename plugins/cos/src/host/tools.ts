import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { authorizeOperation, sessionPermission } from './approval.ts'
import { recordAudit } from './audit.ts'
import { createClient, invoke, mapError, sanitizeKey, type CosClient } from './cos.ts'
import { loadBucket, type BucketSettings, type Queryable, type Secrets } from './config.ts'
import { deleteObject, listObjects, signedDownloadUrl, statObject } from './objects.ts'
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

const contentTypeOf = (path: string): string => {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.'))
  const table: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown',
    '.csv': 'text/csv', '.zip': 'application/zip', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return table[ext] ?? 'application/octet-stream'
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
        action: { type: 'string', enum: ['config', 'upload', 'download', 'delete'], description: 'Optional action filter.' },
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
}
