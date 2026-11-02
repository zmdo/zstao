import type { Queryable } from './service.ts'

export interface AuditEntry {
  sessionId: string | null
  tool: string
  action: string
  domainId: string | null
  domainName: string
  summary: string
  reason: string
  args: unknown
  ok: boolean
  error: string | null
}

export interface AuditFilters {
  page: number
  pageSize: number
  tool: string
  hours: number | undefined
  domain: string
}

export interface AuditItem {
  id: string
  sessionId: string | null
  tool: string
  action: string
  domainId: string | null
  domainName: string
  summary: string
  reason: string
  args: unknown
  ok: boolean
  error: string | null
  createdAt: string
}

export interface AuditPage {
  items: AuditItem[]
  total: number
  page: number
  pageSize: number
}

export async function recordAudit(pool: Queryable, entry: AuditEntry): Promise<void> {
  await pool.query(
    `insert into domain_manager_audit (session_id, tool, action, domain_id, domain_name, summary, args, reason, ok, error)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
    [entry.sessionId, entry.tool, entry.action, entry.domainId, entry.domainName, entry.summary, JSON.stringify(entry.args ?? {}), entry.reason, entry.ok, entry.error],
  )
}

export async function queryAudit(pool: Queryable, filters: AuditFilters): Promise<AuditPage> {
  const where: string[] = []
  const values: unknown[] = []
  if (filters.tool !== '') {
    values.push(filters.tool)
    where.push(`tool = $${values.length}`)
  }
  if (filters.domain !== '') {
    values.push(`%${filters.domain.toLowerCase()}%`)
    where.push(`lower(domain_name) like $${values.length}`)
  }
  if (filters.hours !== undefined) {
    values.push(filters.hours)
    where.push(`created_at >= now() - make_interval(hours => $${values.length})`)
  }
  const clause = where.length === 0 ? '' : `where ${where.join(' and ')}`
  const totalRow = await pool.query<{ total: string }>(`select count(*)::text as total from domain_manager_audit ${clause}`, values)
  const total = Number(totalRow.rows[0]?.total ?? 0)
  values.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
  const { rows } = await pool.query<{
    id: string
    session_id: string | null
    tool: string
    action: string
    domain_id: string | null
    domain_name: string
    summary: string
    reason: string
    args: unknown
    ok: boolean
    error: string | null
    created_at: string
  }>(
    `select id::text, session_id, tool, action, domain_id::text, domain_name, summary, reason, args, ok, error, created_at
     from domain_manager_audit ${clause}
     order by created_at desc, id desc
     limit $${values.length - 1} offset $${values.length}`,
    values,
  )
  return {
    items: rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      tool: row.tool,
      action: row.action,
      domainId: row.domain_id,
      domainName: row.domain_name,
      summary: row.summary,
      reason: row.reason,
      args: row.args,
      ok: row.ok,
      error: row.error,
      createdAt: row.created_at,
    })),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}
