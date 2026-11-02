import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CloudflareError, createDnsRecord, deleteDnsRecord, listDnsRecords, updateDnsRecord, type DnsInput } from '../cloudflare.ts'
import { recordAudit } from './audit.ts'
import { authorizeOperation, sessionPermission } from './approval.ts'
import { loadDomains, resolveDomain, type DomainRow, type Queryable } from './service.ts'

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

export interface ToolDeps {
  pool: Queryable
  secrets: { decrypt(token: string): string }
}

interface ExecLike {
  agent: { id?: string; session?: unknown } | undefined
  callId: unknown
  signal: AbortSignal
}

const DOMAIN_PARAMETER = {
  type: 'string',
  required: true,
  description: 'Managed domain id or its exact name, for example zstao.com. Only domains returned by platform_domain_list are accepted.',
} as const

const REASON_PARAMETER = {
  type: 'string',
  required: true,
  description:
    'Why this DNS change is needed, in one sentence. It is shown to the user for approval and stored in the audit log.',
} as const

const LIST_PARAMETERS = {
  query: { type: 'string', description: 'Optional text matched against the managed domain name or Cloudflare account name.' },
} as const

const DNS_LIST_PARAMETERS = {
  domain: DOMAIN_PARAMETER,
  type: { type: 'string', description: 'Optional DNS record type filter, for example A, AAAA, CNAME, TXT or MX.' },
  page: { type: 'integer', description: 'Page number starting at 1. Defaults to 1.' },
  page_size: { type: 'integer', description: 'Records per page from 1 to 100. Defaults to 100.' },
} as const

const DNS_WRITE_PARAMETERS = {
  domain: DOMAIN_PARAMETER,
  type: { type: 'string', required: true, description: 'DNS record type: A, AAAA, CNAME, TXT, MX, NS, SRV or CAA.' },
  name: { type: 'string', required: true, description: 'Record name. Use @ for the zone apex or a full name such as www.zstao.com.' },
  content: { type: 'string', required: true, description: 'Record content: an IP address, hostname, or text value depending on the type.' },
  ttl: { type: 'integer', description: 'TTL in seconds, or 1 for automatic. Defaults to 1.' },
  proxied: { type: 'boolean', description: 'Proxy through Cloudflare. Only valid for A, AAAA and CNAME. Defaults to false.' },
  priority: { type: 'integer', description: 'MX priority. Only valid for MX records.' },
  comment: { type: 'string', description: 'Optional comment stored with the record.' },
  reason: REASON_PARAMETER,
} as const

const DNS_UPDATE_PARAMETERS = {
  domain: DOMAIN_PARAMETER,
  record_id: { type: 'string', required: true, description: 'Record id returned by platform_domain_dns_list for this domain.' },
  type: { type: 'string', description: 'New record type.' },
  name: { type: 'string', description: 'New record name.' },
  content: { type: 'string', description: 'New record content.' },
  ttl: { type: 'integer', description: 'New TTL in seconds, or 1 for automatic.' },
  proxied: { type: 'boolean', description: 'Proxy through Cloudflare. Only valid for A, AAAA and CNAME.' },
  priority: { type: 'integer', description: 'MX priority. Only valid for MX records.' },
  comment: { type: 'string', description: 'New comment.' },
  reason: REASON_PARAMETER,
} as const

const DNS_DELETE_PARAMETERS = {
  domain: DOMAIN_PARAMETER,
  record_id: { type: 'string', required: true, description: 'Record id returned by platform_domain_dns_list for this domain.' },
  reason: REASON_PARAMETER,
} as const

const AUDIT_PARAMETERS = {
  domain: { type: 'string', description: 'Optional managed domain id or exact name.' },
  action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Optional action filter.' },
  hours: { type: 'integer', description: 'Only records newer than this many hours.' },
  limit: { type: 'integer', description: 'Maximum records from 1 to 100. Defaults to 20.' },
} as const

function fail(code: string, detail: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error: { code, detail, ...extra } })
}

function cfFailure(cause: unknown): string {
  if (cause instanceof CloudflareError) {
    if (cause.status === 0) return fail('network', cause.message)
    if (cause.status === 401 || cause.status === 403 || cause.code === 9109) return fail('cloudflare_forbidden', cause.message)
    if (cause.status === 404) return fail('record_not_found', cause.message)
    if (cause.code === 81057) return fail('record_exists', cause.message)
    return fail('cloudflare', cause.message, { cloudflare_code: cause.code })
  }
  return fail('internal', cause instanceof Error ? cause.message : String(cause))
}

function normalizeType(value: string): string {
  return value.trim().toUpperCase()
}

function ttlOf(value: number | undefined): number {
  if (value === undefined) return 1
  if (value === 1 || (value >= 60 && value <= 86_400)) return value
  throw new Error('ttl must be 1 (automatic) or between 60 and 86400 seconds')
}

function inputOf(args: Record<string, unknown>, partial: boolean): DnsInput {
  const input: DnsInput = {}
  if (!partial || args.type !== undefined) input.type = normalizeType(String(args.type ?? ''))
  if (!partial || args.name !== undefined) input.name = String(args.name ?? '').trim()
  if (!partial || args.content !== undefined) input.content = String(args.content ?? '').trim()
  if (args.ttl !== undefined) input.ttl = ttlOf(Number(args.ttl))
  if (args.proxied !== undefined) input.proxied = args.proxied === true
  if (args.priority !== undefined) input.priority = Number(args.priority)
  if (args.comment !== undefined) input.comment = String(args.comment)
  return input
}

function summaryOf(action: string, record: DnsInput): string {
  if (action === 'delete') return '删除 DNS 记录'
  if (action === 'update') return `修改 ${record.type ?? ''} ${record.name ?? ''}`.trim()
  return `新增 ${record.type ?? ''} ${record.name ?? ''} -> ${record.content ?? ''}`.trim()
}

export function registerDomainTools(scope: Context, deps: ToolDeps): void {
  const audit = async (
    exec: ExecLike,
    row: DomainRow,
    tool: string,
    action: string,
    summary: string,
    reason: string,
    args: Record<string, unknown>,
    ok: boolean,
    error: string | null,
  ): Promise<void> => {
    await recordAudit(deps.pool, {
      sessionId: exec.agent?.id ?? null,
      tool,
      action,
      domainId: row.id,
      domainName: row.name,
      summary,
      reason,
      args,
      ok,
      error,
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
      () => ({ toolName: tool, kind: 'domain_dns_change', reason, displayReason }),
    )

  scope.tools.register(
    defineTool({
      name: 'platform_domain_list',
      description:
        'List domains managed by this platform. Only domains returned here can be addressed by the other domain tools. ' +
        'Each domain carries its id, Cloudflare account, description and China ICP filing flag. ' +
        'A domain with filed=false must not be used with mainland China servers.',
      parameters: LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args: Record<string, unknown>) {
        try {
          const query = String(args.query ?? '').trim().toLowerCase()
          const domains = (await loadDomains(deps.pool)).filter(
            (domain) => query === '' || domain.name.toLowerCase().includes(query) || domain.accountName.toLowerCase().includes(query),
          )
          return JSON.stringify({ domains })
        } catch (cause) {
          return fail('internal', cause instanceof Error ? cause.message : String(cause))
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_domain_dns_list',
      description:
        'List DNS records of one managed domain. Read the record ids here before updating or deleting a record.',
      parameters: DNS_LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args: Record<string, unknown>) {
        const row = await resolveDomain(deps.pool, String(args.domain ?? ''))
        if (row === undefined) return fail('domain_not_found', 'That domain is not managed by this platform.')
        try {
          const page = await listDnsRecords(deps.secrets.decrypt(row.token_ciphertext), row.zone_id, {
            page: Number(args.page ?? 1),
            perPage: Number(args.page_size ?? 100),
            type: args.type === undefined ? undefined : normalizeType(String(args.type)),
          })
          return JSON.stringify({
            domain: { id: row.id, name: row.name, accountName: row.account_name },
            records: page.records,
            page: page.page,
            total_pages: page.totalPages,
            total: page.total,
          })
        } catch (cause) {
          return cfFailure(cause)
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_domain_dns_create',
      description:
        'Create one DNS record under a managed domain. The user approves the change unless the session has full access. ' +
        'Returns the created record with its id.',
      parameters: DNS_WRITE_PARAMETERS,
      output: TEXT_OUTPUT,
      timeoutMs: 120_000,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const row = await resolveDomain(deps.pool, String(args.domain ?? ''))
        if (row === undefined) return fail('domain_not_found', 'That domain is not managed by this platform.')
        let input: DnsInput
        try {
          input = inputOf(args, false)
        } catch (cause) {
          return fail('invalid_argument', cause instanceof Error ? cause.message : String(cause))
        }
        const summary = summaryOf('create', input)
        const reason = String(args.reason ?? '').trim()
        if (reason === '') return fail('invalid_argument', 'reason is required')
        const decision = await approve(
          exec,
          'platform_domain_dns_create',
          `Create ${input.type} ${input.name} -> ${input.content} on ${row.name}. Reason: ${reason}`,
          `在 ${row.name} 上${summary}；原因：${reason}`,
        )
        if (!decision.allowed) {
          await audit(exec, row, 'platform_domain_dns_create', 'create', summary, reason, args, false, `approval_${decision.outcome}`)
          return fail('approval_denied', `The user did not approve this change (${decision.outcome}).`, { outcome: decision.outcome })
        }
        try {
          const record = await createDnsRecord(deps.secrets.decrypt(row.token_ciphertext), row.zone_id, input)
          await audit(exec, row, 'platform_domain_dns_create', 'create', summary, reason, args, true, null)
          return JSON.stringify({ domain: { id: row.id, name: row.name }, record })
        } catch (cause) {
          const message = cfFailure(cause)
          await audit(exec, row, 'platform_domain_dns_create', 'create', summary, reason, args, false, message)
          return message
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_domain_dns_update',
      description:
        'Update one DNS record of a managed domain. Only the given fields change. The user approves the change unless the session has full access.',
      parameters: DNS_UPDATE_PARAMETERS,
      output: TEXT_OUTPUT,
      timeoutMs: 120_000,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const row = await resolveDomain(deps.pool, String(args.domain ?? ''))
        if (row === undefined) return fail('domain_not_found', 'That domain is not managed by this platform.')
        if (args.record_id === undefined || String(args.record_id).trim() === '') {
          return fail('invalid_argument', 'record_id is required')
        }
        const fields = ['type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment'].filter((key) => args[key] !== undefined)
        if (fields.length === 0) return fail('invalid_argument', 'At least one field to change is required')
        let input: DnsInput
        try {
          input = inputOf(args, true)
        } catch (cause) {
          return fail('invalid_argument', cause instanceof Error ? cause.message : String(cause))
        }
        const summary = `修改记录 ${String(args.record_id)}`
        const reason = String(args.reason ?? '').trim()
        if (reason === '') return fail('invalid_argument', 'reason is required')
        const decision = await approve(
          exec,
          'platform_domain_dns_update',
          `Update record ${String(args.record_id)} on ${row.name}: ${JSON.stringify(input)}. Reason: ${reason}`,
          `修改 ${row.name} 的 DNS 记录（${String(args.record_id)}）；原因：${reason}`,
        )
        if (!decision.allowed) {
          await audit(exec, row, 'platform_domain_dns_update', 'update', summary, reason, args, false, `approval_${decision.outcome}`)
          return fail('approval_denied', `The user did not approve this change (${decision.outcome}).`, { outcome: decision.outcome })
        }
        try {
          const record = await updateDnsRecord(deps.secrets.decrypt(row.token_ciphertext), row.zone_id, String(args.record_id), input)
          await audit(exec, row, 'platform_domain_dns_update', 'update', summary, reason, args, true, null)
          return JSON.stringify({ domain: { id: row.id, name: row.name }, record })
        } catch (cause) {
          const message = cfFailure(cause)
          await audit(exec, row, 'platform_domain_dns_update', 'update', summary, reason, args, false, message)
          return message
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_domain_dns_delete',
      description:
        'Delete one DNS record of a managed domain. The user approves the change unless the session has full access. ' +
        'Returns the deleted record snapshot.',
      parameters: DNS_DELETE_PARAMETERS,
      output: TEXT_OUTPUT,
      timeoutMs: 120_000,
      async execute(args: Record<string, unknown>, exec: ExecLike) {
        const row = await resolveDomain(deps.pool, String(args.domain ?? ''))
        if (row === undefined) return fail('domain_not_found', 'That domain is not managed by this platform.')
        if (args.record_id === undefined || String(args.record_id).trim() === '') {
          return fail('invalid_argument', 'record_id is required')
        }
        const summary = `删除记录 ${String(args.record_id)}`
        const reason = String(args.reason ?? '').trim()
        if (reason === '') return fail('invalid_argument', 'reason is required')
        const decision = await approve(
          exec,
          'platform_domain_dns_delete',
          `Delete DNS record ${String(args.record_id)} on ${row.name}. Reason: ${reason}`,
          `删除 ${row.name} 的 DNS 记录（${String(args.record_id)}）；原因：${reason}`,
        )
        if (!decision.allowed) {
          await audit(exec, row, 'platform_domain_dns_delete', 'delete', summary, reason, args, false, `approval_${decision.outcome}`)
          return fail('approval_denied', `The user did not approve this change (${decision.outcome}).`, { outcome: decision.outcome })
        }
        try {
          const record = await deleteDnsRecord(deps.secrets.decrypt(row.token_ciphertext), row.zone_id, String(args.record_id))
          await audit(exec, row, 'platform_domain_dns_delete', 'delete', summary, reason, args, true, null)
          return JSON.stringify({ domain: { id: row.id, name: row.name }, deleted: record ?? null })
        } catch (cause) {
          const message = cfFailure(cause)
          await audit(exec, row, 'platform_domain_dns_delete', 'delete', summary, reason, args, false, message)
          return message
        }
      },
    }),
  )

  scope.tools.register(
    defineTool({
      name: 'platform_domain_audit_list',
      description:
        'List recent DNS change audit records for managed domains, including the reason given for each change. ' +
        'Use it to answer what was changed, why, by which session and whether it succeeded.',
      parameters: AUDIT_PARAMETERS,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args: Record<string, unknown>) {
        const domain = String(args.domain ?? '').trim()
        const action = String(args.action ?? '').trim()
        const hours = args.hours === undefined ? undefined : Number(args.hours)
        const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100)
        const where: string[] = []
        const values: unknown[] = []
        if (domain !== '') {
          values.push(domain)
          where.push(`lower(domain_name) = lower($${values.length})`)
        }
        if (action !== '') {
          values.push(action)
          where.push(`action = $${values.length}`)
        }
        if (hours !== undefined && Number.isFinite(hours) && hours > 0) {
          values.push(hours)
          where.push(`created_at >= now() - make_interval(hours => $${values.length})`)
        }
        const clause = where.length === 0 ? '' : `where ${where.join(' and ')}`
        values.push(limit)
        try {
          const { rows } = await deps.pool.query<{
            id: string
            tool: string
            action: string
            domain_name: string
            summary: string
            reason: string
            ok: boolean
            error: string | null
            created_at: string
          }>(
            `select id::text, tool, action, domain_name, summary, reason, ok, error, created_at
             from domain_manager_audit ${clause}
             order by created_at desc, id desc
             limit $${values.length}`,
            values,
          )
          return JSON.stringify({
            count: rows.length,
            items: rows.map((row) => ({
              time: row.created_at,
              tool: row.tool,
              action: row.action,
              domain: row.domain_name,
              summary: row.summary,
              reason: row.reason,
              ok: row.ok,
              error: row.error,
            })),
          })
        } catch (cause) {
          return fail('internal', cause instanceof Error ? cause.message : String(cause))
        }
      },
    }),
  )
}
