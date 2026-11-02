/** How an index request is answered once the console session is known. */
export type IndexGate = 'login' | 'app' | 'mint'

/**
 * No console session draws the login page. A session that already holds the
 * page connection is served directly. A new session mints that connection.
 */
export function indexGate(consoleSession: boolean, dshAdmitted: boolean): IndexGate {
  if (!consoleSession) return 'login'
  if (dshAdmitted) return 'app'
  return 'mint'
}

/** The raw `smp_session` value, without checking its signature. */
export function smpSessionValue(cookieHeader: string): string | undefined {
  for (const segment of cookieHeader.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== 'smp_session') continue
    const value = segment.slice(at + 1).trim()
    return value === '' ? undefined : value
  }
  return undefined
}

/** Names of page-connection cookies carried on this request. */
export function dshAuthCookieNames(cookieHeader: string): string[] {
  const names: string[] = []
  for (const segment of cookieHeader.split(';')) {
    const at = segment.indexOf('=')
    const name = (at === -1 ? segment : segment.slice(0, at)).trim()
    if (name.startsWith('dsh-auth-')) names.push(name)
  }
  return names
}

/** Expire page-connection cookies. Attributes match the ones that set them. */
export function clearDshCookieHeaders(names: readonly string[]): string[] {
  return names.map(name =>
    `${name}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict`)
}

/** Index URL whose only token is the one the host process already holds. */
export function tokenExchangeUrl(requestUrl: string, token: string): string {
  const url = new URL(requestUrl === '' ? '/' : requestUrl, 'http://dsh.invalid')
  url.searchParams.delete('token')
  url.searchParams.set('token', token)
  return `${url.pathname}${url.search}`
}
