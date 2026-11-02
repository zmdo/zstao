import * as queries from './persistence/repository.ts'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Db } from '../database/connection.ts'
import { transaction } from '../database/transaction.ts'
import { mutate, approve } from './approval.ts'
import { account, audit } from './persistence/repository.ts'
import {
  AdminError,
  fields,
  text,
  uuid,
  instant,
  type AdminDeps,
  type AdminContext,
  type Input,
} from './model.ts'
import { digest } from '../recipes/canonical.ts'
const LIMIT = 10000
export function auditFilter(input: Input) {
  fields(input, [
    'from',
    'to',
    'server_id',
    'kind',
    'status',
    'session_id',
    'tool',
    'page',
    'page_size',
  ])
  const page = input.page ?? 1,
    size = input.page_size ?? 20
  if (
    !Number.isSafeInteger(page) ||
    Number(page) < 1 ||
    !Number.isSafeInteger(size) ||
    Number(size) < 1 ||
    Number(size) > 100
  )
    throw new AdminError('audit_invalid')
  const date = (value: unknown) => {
    if (value === undefined) return null
    return instant(value, 'audit_invalid')
  }
  const from = date(input.from),
    to = date(input.to)
  if (from && to && from >= to) throw new AdminError('audit_invalid')
  return {
    page: Number(page),
    size: Number(size),
    values: [
      from,
      to,
      input.server_id === undefined ? null : uuid(input.server_id),
      input.kind === undefined ? '' : text(input.kind),
      input.status === undefined ? '' : text(input.status),
      input.session_id === undefined ? '' : text(input.session_id),
      input.tool === undefined ? '' : text(input.tool),
    ],
  }
}
export async function auditAction(
  deps: AdminDeps,
  ctx: AdminContext,
  action: string,
  input: Input,
) {
  if (action === 'retention') return retentionAction(deps, ctx, input)
  const filter = auditFilter(input)
  if (action === 'query') {
    const rows = await queries.filteredAudits(deps.db, [
      ...filter.values,
      filter.size,
      (filter.page - 1) * filter.size,
    ])
    const total = (await queries.filteredAuditCount<{ count: string }>(deps.db, filter.values))
      .rows[0]!.count
    return { items: rows.rows, total: Number(total), page: filter.page, page_size: filter.size }
  }
  const actor = await approve(deps, ctx, 'platform_audit_admin', 'export', 'audit', {
    filter: input,
    maximum_records: LIMIT,
  })
  return transaction(deps.db, async (db) => {
    if (ctx.signal.aborted) throw new AdminError('cancelled')
    const rows = (await queries.exportAudits(db, [...filter.values, LIMIT + 1])).rows
    if (rows.length > LIMIT) throw new AdminError('export_too_large_narrow_filter')
    const id = randomUUID()
    await queries.insertAuditDownload(db, [id, JSON.stringify(rows, null, 2)])
    await audit(db, {
      tool: 'platform_audit_admin',
      action: 'export',
      target: id,
      after: { count: rows.length, filter: input },
      status: 'succeeded',
      actor,
      context: ctx,
      approval: 'approved',
    })
    return {
      count: rows.length,
      url: `/console-api/server-admin-downloads/${id}`,
      expires_in_seconds: 600,
    }
  })
}
interface Policy {
  days: number
  archive_directory: string
  next_run: Date
  revision: string
  enabled: boolean
  approved_by: string
  approval_id: string
  approved_at: Date
  authorization_source: 'full-access' | 'user-approval'
}
async function policy(db: Db, lock = false) {
  return (await queries.retentionPolicy<Policy>(db, [], lock)).rows[0] ?? null
}
async function retentionAction(deps: AdminDeps, ctx: AdminContext, input: Input) {
  const mode = text(input.mode)
  fields(
    input,
    mode === 'set' ? ['mode', 'days', 'archive_directory', 'next_run', 'enabled'] : ['mode'],
  )
  if (mode === 'get') return policy(deps.db)
  if (mode === 'run') {
    const p = await policy(deps.db)
    if (!p) throw new AdminError('retention_not_configured')
    const cutoff = new Date(Date.now() - p.days * 86400000)
    const rows = (await queries.expiredAudits<{ id: string }>(deps.db, [cutoff, LIMIT], false)).rows
    const ids = rows.map((row) => row.id)
    const actor = await approve(deps, ctx, 'platform_audit_admin', 'retention', 'audit_policy', {
      policy: p,
      cutoff: cutoff.toISOString(),
      count: ids.length,
      records_digest: digest(ids),
      batch_limit: LIMIT,
    })
    return runRetention(deps.db, ctx, actor, p, { cutoff, ids })
  }
  if (
    mode !== 'set' ||
    !Number.isSafeInteger(input.days) ||
    Number(input.days) < 1 ||
    Number(input.days) > 36500 ||
    typeof input.enabled !== 'boolean'
  )
    throw new AdminError('invalid_request')
  const directory = text(input.archive_directory, 4096),
    next = instant(input.next_run)
  if (!isAbsolute(directory) || !Number.isFinite(+next) || +next < Date.now())
    throw new AdminError('invalid_request')
  return mutate(
    deps,
    ctx,
    'platform_audit_admin',
    'retention',
    'audit_policy',
    policy,
    async (db) => {
      await queries.saveRetentionPolicy(db, [
        input.days,
        directory,
        next,
        input.enabled,
        await account(db),
        ctx.callId,
        ctx.authorization?.source ?? 'user-approval',
      ])
      return policy(db)
    },
    input,
  )
}
export async function runRetention(
  db: Db,
  ctx: AdminContext,
  actor: string,
  p: Policy,
  expected?: { cutoff: Date; ids: string[] },
) {
  try {
    return await transaction(db, async (c) => {
      if (ctx.signal.aborted) throw new AdminError('cancelled')
      await queries.lockRetention(c, [])
      const current = await policy(c, true)
      if (!current || digest(current) !== digest(p))
        throw new AdminError('retention_policy_changed')
      const cutoff = expected?.cutoff ?? new Date(Date.now() - p.days * 86400000)
      const rows = (await queries.expiredAudits<{ id: string }>(c, [cutoff, LIMIT])).rows
      if (expected && digest(expected.ids) !== digest(rows.map((row) => row.id)))
        throw new AdminError('retention_snapshot_changed')
      let archive: string | null = null
      let checksum: string | null = null
      if (rows.length) {
        await mkdir(p.archive_directory, { recursive: true, mode: 0o700 })
        archive = join(p.archive_directory, `server-audit-${randomUUID()}.json`)
        const content = JSON.stringify(rows)
        checksum = createHash('sha256').update(content).digest('hex')
        const file = await open(archive, 'wx', 0o600)
        try {
          await file.writeFile(content)
          await file.sync()
        } finally {
          await file.close()
        }
        const directory = await open(p.archive_directory, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
        const verified = await readFile(archive, 'utf8')
        if (checksum !== createHash('sha256').update(verified).digest('hex'))
          throw new AdminError('archive_verification_failed')
        if (ctx.signal.aborted) throw new AdminError('cancelled')
        await queries.deleteArchivedAudits(c, [rows.map((row) => row.id)])
      }
      const result = {
        archived: rows.length,
        archive,
        checksum,
        cutoff: cutoff.toISOString(),
        batch_limit: LIMIT,
      }
      if (ctx.signal.aborted) throw new AdminError('cancelled')
      await queries.advanceRetention(c, [])
      await audit(c, {
        tool: 'platform_audit_admin',
        action: 'retention',
        target: 'audit_policy',
        before: p,
        after: result,
        status: 'succeeded',
        actor,
        context: ctx,
        approval: 'approved',
      })
      return result
    })
  } catch (cause) {
    await audit(db, {
      tool: 'platform_audit_admin',
      action: 'retention',
      target: 'audit_policy',
      before: p,
      after: { code: cause instanceof AdminError ? cause.code : 'archive_failed' },
      status: 'failed',
      actor,
      context: ctx,
      approval: 'approved',
    })
    throw cause
  }
}
export async function scheduledRetention(db: Db, signal: AbortSignal) {
  if (signal.aborted) return
  await queries.purgeDownloads(db)
  const p = await policy(db)
  if (!p?.enabled || +p.next_run > Date.now()) return
  await runRetention(
    db,
    {
      callId: randomUUID(),
      signal,
      source: 'system',
      approvalId: p.approval_id,
      approvedAt: p.approved_at,
      authorization: {
        source: p.authorization_source,
        permissionMode: p.authorization_source === 'full-access' ? 'danger-full-access' : undefined,
      },
    },
    p.approved_by,
    p,
  )
}
