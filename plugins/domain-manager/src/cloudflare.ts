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
  modifiedOn: string
  comment: string
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

interface Envelope {
  success?: boolean
  errors?: { code?: number; message?: string }[]
  result?: unknown
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
    throw new Error(`cloudflare request failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const body = (await response.json().catch(() => undefined)) as Envelope | undefined
  return { status: response.status, ok: response.ok, body }
}

function failureDetail(body: Envelope | undefined, fallback: string): string {
  const first = body?.errors?.[0]
  return first?.message ?? fallback
}

function rows(body: Envelope | undefined): ZoneRow[] {
  return Array.isArray(body?.result) ? (body.result as ZoneRow[]) : []
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
  let verify
  try {
    verify = await call(token, '/user/tokens/verify', { method: 'GET' }, options)
  } catch (cause) {
    return { ok: false, code: 'network', detail: cause instanceof Error ? cause.message : String(cause) }
  }
  if (!verify.ok || verify.body?.success === false) {
    return { ok: false, code: 'unauthorized', detail: failureDetail(verify.body, 'token rejected') }
  }

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
  if (zones.status === 401 || zones.status === 403) {
    return { ok: false, code: 'unauthorized', detail: failureDetail(zones.body, 'token rejected') }
  }
  if (!zones.ok) {
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

export async function listDnsRecords(token: string, zoneId: string, options: FetchOptions = {}): Promise<DnsRecord[]> {
  const page = await call(token, `/zones/${zoneId}/dns_records?per_page=100&page=1`, { method: 'GET' }, options)
  if (page.status === 403 || page.status === 401) throw new Error('dns_read_forbidden')
  if (!page.ok) throw new Error(failureDetail(page.body, `cloudflare status ${page.status}`))
  const list = Array.isArray(page.body?.result) ? (page.body.result as Record<string, unknown>[]) : []
  return list.map((row) => ({
    id: String(row.id ?? ''),
    type: String(row.type ?? ''),
    name: String(row.name ?? ''),
    content: String(row.content ?? ''),
    ttl: Number(row.ttl ?? 0),
    proxied: row.proxied === true,
    modifiedOn: String(row.modified_on ?? ''),
    comment: String(row.comment ?? ''),
  }))
}
