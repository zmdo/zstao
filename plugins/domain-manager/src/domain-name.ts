/** Lowercase a bare host name and reject anything that is not a domain. */
export function normalizeDomain(input: string): string | undefined {
  const raw = input.trim().toLowerCase()
  if (raw === '') return undefined
  const withoutScheme = raw.includes('://') ? raw.slice(raw.indexOf('://') + 3) : raw
  const host = withoutScheme.split('/')[0].split('?')[0].split(':')[0].replace(/\.$/, '')
  if (host.length === 0 || host.length > 253) return undefined
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) return undefined
  return host
}

/** Cloudflare answers with an exact zone when the token can see it; pick only that name. */
export function pickZone<T extends { name: string }>(zones: readonly T[], domain: string): T | undefined {
  return zones.find((zone) => zone.name.toLowerCase() === domain)
}
