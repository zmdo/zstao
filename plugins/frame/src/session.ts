import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_AGE_SECONDS = 14 * 24 * 3600

export function sessionCookie(token: string): string {
  return `smp_session=${token}; Max-Age=${MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax`
}

export function clearSessionCookie(): string {
  return 'smp_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax'
}

/** Sign a console session. The value is the username, checked again when it is used. */
export function sealSession(username: string, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({
    u: username,
    e: Math.floor(now / 1000) + MAX_AGE_SECONDS,
  })).toString('base64url')
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

/** Username from a cookie this process signed, or undefined when it is missing, altered, or expired. */
export function openSession(token: string, secret: string, now = Date.now()): string | undefined {
  const dot = token.indexOf('.')
  if (dot <= 0) return undefined
  const body = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const left = Buffer.from(mac)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined
  let payload: { u?: unknown; e?: unknown }
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown }
  } catch (error) {
    // A truncated cookie is not a session.
    void error
    return undefined
  }
  if (typeof payload.u !== 'string' || payload.u === '') return undefined
  if (typeof payload.e !== 'number' || payload.e * 1000 <= now) return undefined
  return payload.u
}
