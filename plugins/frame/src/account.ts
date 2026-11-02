import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { hashPassword, verifyPassword } from './password.ts'
import { smpSessionValue } from './gate.ts'
import { openSession } from './session.ts'
import { verifyTotp } from './totp.ts'

const DEFAULT_PASSWORD = 'changeme'

export interface AccountRow {
  username: string
  password_hash: string
  totp_enabled: boolean
  totp_secret: string | null
  totp_pending_secret: string | null
}

export interface ShellAccountConfig {
  initialUsername: string
  initialPassword?: string
}

export type LoginDecision =
  | { kind: 'ok'; username: string }
  | { kind: 'totp' }
  | { kind: 'unauthorized'; detail: string }

export async function ensureAccount(pool: Pool, config: ShellAccountConfig): Promise<void> {
  const count = await pool.query<{ count: number }>('select count(*)::int as count from accounts')
  const existing = count.rows[0]?.count ?? 0
  if (existing > 0) return
  const password = config.initialPassword
  if (password === undefined || password === '') {
    throw new Error('初始密码没有配置，账户表是空的')
  }
  const username = config.initialUsername.trim() || 'admin'
  await pool.query(
    `insert into accounts (id, username, password_hash, totp_enabled)
     values ($1, $2, $3, false)`,
    [randomUUID(), username, hashPassword(password)],
  )
}

/** The account named by a still-valid session cookie, when that account still exists. */
export async function accountFromCookie(pool: Pool, secret: string, cookieHeader: string): Promise<AccountRow | undefined> {
  const token = smpSessionValue(cookieHeader)
  if (token === undefined) return undefined
  const username = openSession(token, secret)
  if (username === undefined) return undefined
  return findAccount(pool, username)
}

export async function findAccount(pool: Pool, username: string): Promise<AccountRow | undefined> {
  const result = await pool.query<AccountRow>(
    `select username, password_hash, totp_enabled, totp_secret, totp_pending_secret
     from accounts where username = $1`,
    [username],
  )
  return result.rows[0]
}

export function decideLogin(account: AccountRow | undefined, password: string, totpCode: string | undefined): LoginDecision {
  if (account === undefined || !verifyPassword(password, account.password_hash)) {
    return { kind: 'unauthorized', detail: '用户名或密码不正确' }
  }
  if (!account.totp_enabled) return { kind: 'ok', username: account.username }
  if (totpCode === undefined || totpCode.trim() === '') return { kind: 'totp' }
  if (account.totp_secret === null || !verifyTotp(account.totp_secret, totpCode)) {
    return { kind: 'unauthorized', detail: '验证码不正确' }
  }
  return { kind: 'ok', username: account.username }
}

export function passwordIsDefault(passwordHash: string): boolean {
  return verifyPassword(DEFAULT_PASSWORD, passwordHash)
}
