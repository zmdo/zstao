import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { ServerError } from '../../shared/errors.ts'

export function formatPlace(country: string, region: string, city: string): string {
  const parts: string[] = []
  const nation = country.trim()
  const area = region.trim()
  const town = city.trim()
  if (nation !== '') parts.push(nation)
  if (area !== '' && !parts.includes(area) && area.length <= 8) parts.push(area)
  else if (town !== '' && !parts.includes(town)) parts.push(town)
  return parts.join(' ').slice(0, 80)
}

export function chosenRegion(
  host: string,
  written: string | null | undefined,
  lookedUp: string | null,
): string | null {
  const text = (written ?? '').trim()
  if (text !== '') {
    if (text.length > 80) throw new ServerError('region_invalid')
    return text
  }
  return lookedUp
}

/** Private and loopback addresses are not sent to a public lookup. */
export function privatePlace(address: string): '内网' | undefined {
  const value = address.trim()
  if (!isIP(value)) return undefined
  if (
    value === '::1' ||
    value.startsWith('127.') ||
    value.startsWith('10.') ||
    value.startsWith('192.168.') ||
    value.startsWith('169.254.')
  )
    return '内网'
  const octets = value.split('.').map((part) => Number(part))
  const second = octets[1]
  if (octets[0] === 172 && second !== undefined && second >= 16 && second <= 31) return '内网'
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80')) return '内网'
  return undefined
}

/** Blank region becomes 内网 for a private address, or a looked-up place. */
export async function lookupRegion(host: string): Promise<string | null> {
  const address = await resolveAddress(host.trim())
  if (address === null) return null
  const local = privatePlace(address)
  if (local !== undefined) return local
  try {
    const response = await fetch(`https://ipwho.is/${address}?lang=zh-CN`, {
      signal: AbortSignal.timeout(6000),
    })
    const payload = (await response.json()) as {
      success?: unknown
      country?: unknown
      region?: unknown
      city?: unknown
    }
    if (payload.success !== true) return null
    const place = formatPlace(
      String(payload.country ?? ''),
      String(payload.region ?? ''),
      String(payload.city ?? ''),
    )
    return place === '' ? null : place
  } catch (cause) {
    void cause
    return null
  }
}

async function resolveAddress(host: string): Promise<string | null> {
  if (isIP(host)) return host
  try {
    const found = await lookup(host)
    return found.address
  } catch (cause) {
    void cause
    return null
  }
}
