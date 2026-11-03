import type { Queryable } from './config.ts'

export interface AuditEntry {
  sessionId: string | null
  actor: 'console' | 'tool'
  action: 'config' | 'upload' | 'download' | 'delete' | 'move' | 'copy' | 'batch'
  objectKey: string
  sizeBytes: number | null
  ok: boolean
  error: string | null
  detail: unknown
}

export interface AuditFilters {
  page: number
  pageSize: number
  action: string
  hours: number | undefined
  key: string
}

export interface AuditItem {
  id: string
  sessionId: string | null
  actor: string
  action: string
  objectKey: string
  sizeBytes: number | null
  ok: boolean
  error: string | null
  detail: unknown
  createdAt: string
}

export async function recordAudit(pool: Queryable, entry: AuditEntry): Promise<void> {
  await pool.query(
    `insert into cos_audit (session_id, actor, action, object_key, size_bytes, ok, error, detail)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [entry.sessionId, entry.actor, entry.action, entry.objectKey, entry.sizeBytes, entry.ok, entry.error, JSON.stringify(entry.detail ?? {})],
  )
}

export async function queryAudit(pool: Queryable, filters: AuditFilters): Promise<{ items: AuditItem[]; total: number; page: number; pageSize: number }> {
  const where: string[] = []
  const values: unknown[] = []
  if (filters.action !== '') {
    values.push(filters.action)
    where.push(`action = $${values.length}`)
  }
  if (filters.key !== '') {
    values.push(`%${filters.key.toLowerCase()}%`)
    where.push(`lower(object_key) like $${values.length}`)
  }
  if (filters.hours !== undefined) {
    values.push(filters.hours)
    where.push(`created_at >= now() - make_interval(hours => $${values.length})`)
  }
  const clause = where.length === 0 ? '' : `where ${where.join(' and ')}`
  const totalRow = await pool.query<{ total: string }>(`select count(*)::text as total from cos_audit ${clause}`, values)
  const total = Number(totalRow.rows[0]?.total ?? 0)
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
  const { rows } = await pool.query<{
    id: string
    session_id: string | null
    actor: string
    action: string
    object_key: string
    size_bytes: string | null
    ok: boolean
    error: string | null
    detail: unknown
    created_at: string
  }>(
    `select id::text, session_id, actor, action, object_key, size_bytes, ok, error, detail, created_at
     from cos_audit ${clause}
     order by created_at desc, id desc
     limit $${values.length - 1} offset $${values.length}`,
    values,
  )
  return {
    items: rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      actor: row.actor,
      action: row.action,
      objectKey: row.object_key,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      ok: row.ok,
      error: row.error,
      detail: row.detail,
      createdAt: row.created_at,
    })),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}
