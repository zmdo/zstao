const BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareZone {
  id: string
  name: string
  accountId: string
  accountName: string
}

export interface DnsRecord {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied: boolean
  priority?: number
  modifiedOn: string
  comment: string
}

export interface DnsInput {
  type?: string
  name?: string
  content?: string
  ttl?: number
  proxied?: boolean
  priority?: number
  comment?: string
}

export interface DnsPage {
  records: DnsRecord[]
  page: number
  totalPages: number
  total: number
}

export type ZoneFailure =
  | 'unauthorized'
  | 'zone_not_found'
  | 'account_mismatch'
  | 'dns_read_forbidden'
  | 'dns_write_forbidden'
  | 'network'

export type ZoneCheck =
  | { ok: true; zone: CloudflareZone }
  | { ok: false; code: ZoneFailure; detail: string }

export interface FetchOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

/** A Cloudflare resource answered with an error; the token is never part of the message. */
export class CloudflareError extends Error {
  readonly status: number
  readonly code: number | undefined

  constructor(status: number, code: number | undefined, message: string) {
    super(message)
    this.name = 'CloudflareError'
    this.status = status
    this.code = code
  }
}

interface Envelope {
  success?: boolean
  errors?: { code?: number; message?: string }[]
  result?: unknown
  result_info?: { page?: number; total_pages?: number; total_count?: number }
}

interface ZoneRow {
  id?: string
  name?: string
  account?: { id?: string; name?: string }
}

async function call(
  token: string,
  path: string,
  init: RequestInit,
  options: FetchOptions,
): Promise<{ status: number; ok: boolean; body: Envelope | undefined }> {
  const doFetch = options.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
  } catch (cause) {
    throw new CloudflareError(0, undefined, `cloudflare request failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const body = (await response.json().catch(() => undefined)) as Envelope | undefined
  return { status: response.status, ok: response.ok, body }
}

function failureDetail(body: Envelope | undefined, fallback: string): string {
  const first = body?.errors?.[0]
  return first?.message ?? fallback
}

function failureCode(body: Envelope | undefined): number | undefined {
  return body?.errors?.[0]?.code
}

function rows(body: Envelope | undefined): ZoneRow[] {
  return Array.isArray(body?.result) ? (body.result as ZoneRow[]) : []
}

/**
 * Scoped tokens can fail `/user/tokens/verify` while still reading zones, so
 * authentication is judged by the resource call instead of the verify endpoint.
 */
function isAuthError(status: number, body: Envelope | undefined): boolean {
  if (status === 401 || status === 403) return true
  const code = failureCode(body)
  return code === 1000 || code === 10000 || code === 9109
}

function toDnsRecord(row: Record<string, unknown>): DnsRecord {
  return {
    id: String(row.id ?? ''),
    type: String(row.type ?? ''),
    name: String(row.name ?? ''),
    content: String(row.content ?? ''),
    ttl: Number(row.ttl ?? 0),
    proxied: row.proxied === true,
    priority: typeof row.priority === 'number' ? row.priority : undefined,
    modifiedOn: String(row.modified_on ?? ''),
    comment: String(row.comment ?? ''),
  }
}

/**
 * Verify one token can see this zone under the given account and edit its DNS.
 *
 * Zones are looked up with an `account.id` filter so a zone in a different
 * Cloudflare account is reported as a mismatch instead of being accepted. The
 * write check posts a record with an unknown type: Cloudflare rejects the type
 * with 400 for an authorized token and answers 403 when the token lacks
 * DNS:Edit, so nothing is created in either branch.
 */
export async function checkZone(
  token: string,
  domain: string,
  accountId: string,
  options: FetchOptions = {},
): Promise<ZoneCheck> {
  let zones
  try {
    zones = await call(
      token,
      `/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(accountId)}&per_page=50`,
      { method: 'GET' },
      options,
    )
  } catch (cause) {
    return { ok: false, code: 'network', detail: cause instanceof Error ? cause.message : String(cause) }
  }
  if (!zones.ok) {
    if (isAuthError(zones.status, zones.body)) {
      return { ok: false, code: 'unauthorized', detail: failureDetail(zones.body, 'token rejected') }
    }
    return { ok: false, code: 'network', detail: failureDetail(zones.body, `cloudflare status ${zones.status}`) }
  }

  const zone = rows(zones.body).find((row) => typeof row.name === 'string' && row.name.toLowerCase() === domain)
  if (zone === undefined || typeof zone.id !== 'string') {
    // A zone outside the given account must not look like a missing domain.
    let anywhere
    try {
      anywhere = await call(token, `/zones?name=${encodeURIComponent(domain)}&per_page=50`, { method: 'GET' }, options)
    } catch (cause) {
      return { ok: false, code: 'network', detail: cause instanceof Error ? cause.message : String(cause) }
    }
    if (isAuthError(anywhere.status, anywhere.body)) {
      return { ok: false, code: 'unauthorized', detail: failureDetail(anywhere.body, 'token rejected') }
    }
    const seen = rows(anywhere.body).some((row) => typeof row.name === 'string' && row.name.toLowerCase() === domain)
    return seen
      ? { ok: false, code: 'account_mismatch', detail: `zone ${domain} belongs to another account` }
      : { ok: false, code: 'zone_not_found', detail: `zone ${domain} is not visible to this token` }
  }

  let read
  try {
    read = await call(token, `/zones/${zone.id}/dns_records?per_page=1`, { method: 'GET' }, options)
  } catch (cause) {
    return { ok: false, code: 'network', detail: cause instanceof Error ? cause.message : String(cause) }
  }
  if (read.status === 403 || read.status === 401) {
    return { ok: false, code: 'dns_read_forbidden', detail: failureDetail(read.body, 'dns read rejected') }
  }

  let probe
  try {
    probe = await call(
      token,
      `/zones/${zone.id}/dns_records`,
      { method: 'POST', body: JSON.stringify({ type: 'CES_PERMISSION_PROBE', name: `_ces-probe.${domain}`, content: 'probe' }) },
      options,
    )
  } catch (cause) {
    return { ok: false, code: 'network', detail: cause instanceof Error ? cause.message : String(cause) }
  }
  if (probe.status === 403 || probe.status === 401) {
    return { ok: false, code: 'dns_write_forbidden', detail: failureDetail(probe.body, 'dns write rejected') }
  }
  if (probe.ok) {
    // An unknown record type must not be accepted; treat it as an unexpected token policy.
    return { ok: false, code: 'dns_write_forbidden', detail: 'cloudflare accepted an invalid probe record' }
  }

  return {
    ok: true,
    zone: {
      id: zone.id,
      name: zone.name as string,
      accountId: zone.account?.id ?? accountId,
      accountName: zone.account?.name ?? '',
    },
  }
}

export interface DnsListOptions extends FetchOptions {
  page?: number
  perPage?: number
  type?: string
  name?: string
}

export async function listDnsRecords(token: string, zoneId: string, options: DnsListOptions = {}): Promise<DnsPage> {
  const perPage = Math.min(Math.max(options.perPage ?? 100, 1), 100)
  const page = Math.max(options.page ?? 1, 1)
  const query = new URLSearchParams({ per_page: String(perPage), page: String(page) })
  if (options.type !== undefined && options.type !== '') query.set('type', options.type)
  if (options.name !== undefined && options.name !== '') query.set('name', options.name)
  const answer = await call(token, `/zones/${zoneId}/dns_records?${query.toString()}`, { method: 'GET' }, options)
  if (answer.status === 403 || answer.status === 401) throw new CloudflareError(answer.status, failureCode(answer.body), 'dns_read_forbidden')
  if (!answer.ok) throw new CloudflareError(answer.status, failureCode(answer.body), failureDetail(answer.body, `cloudflare status ${answer.status}`))
  const list = Array.isArray(answer.body?.result) ? (answer.body.result as Record<string, unknown>[]) : []
  return {
    records: list.map(toDnsRecord),
    page: Number(answer.body?.result_info?.page ?? page),
    totalPages: Number(answer.body?.result_info?.total_pages ?? 1),
    total: Number(answer.body?.result_info?.total_count ?? list.length),
  }
}

export async function getDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
  options: FetchOptions = {},
): Promise<DnsRecord> {
  const answer = await call(token, `/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`, { method: 'GET' }, options)
  if (!answer.ok) throw new CloudflareError(answer.status, failureCode(answer.body), failureDetail(answer.body, `cloudflare status ${answer.status}`))
  return toDnsRecord(answer.body?.result as Record<string, unknown>)
}

export async function createDnsRecord(
  token: string,
  zoneId: string,
  input: DnsInput,
  options: FetchOptions = {},
): Promise<DnsRecord> {
  const answer = await call(
    token,
    `/zones/${zoneId}/dns_records`,
    { method: 'POST', body: JSON.stringify(input) },
    options,
  )
  if (!answer.ok) throw new CloudflareError(answer.status, failureCode(answer.body), failureDetail(answer.body, `cloudflare status ${answer.status}`))
  return toDnsRecord(answer.body?.result as Record<string, unknown>)
}

export async function updateDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
  input: DnsInput,
  options: FetchOptions = {},
): Promise<DnsRecord> {
  const answer = await call(
    token,
    `/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
    options,
  )
  if (!answer.ok) throw new CloudflareError(answer.status, failureCode(answer.body), failureDetail(answer.body, `cloudflare status ${answer.status}`))
  return toDnsRecord(answer.body?.result as Record<string, unknown>)
}

export async function deleteDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
  options: FetchOptions = {},
): Promise<DnsRecord | undefined> {
  const snapshot = await getDnsRecord(token, zoneId, recordId, options)
  const answer = await call(token, `/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`, { method: 'DELETE' }, options)
  if (!answer.ok) throw new CloudflareError(answer.status, failureCode(answer.body), failureDetail(answer.body, `cloudflare status ${answer.status}`))
  return snapshot
}
