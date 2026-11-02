import type { Pool, PoolClient } from 'pg'
import { hashPassword, verifyPassword } from './password.ts'
import { newSecret, provisioningUri, verifyTotp } from './totp.ts'
import { decryptMnemonic, encryptMnemonic, VaultError } from './vault.ts'

export interface SecurityAccount {
  username: string
  password_hash: string
  totp_enabled: boolean
  totp_secret: string | null
  totp_pending_secret: string | null
}

export type SecurityResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; detail: string }

const USERNAME_LIMIT = 64

export function cleanUsername(value: string): SecurityResult<{ username: string }> {
  const username = value.trim()
  if (username === '' || /\s/u.test(username)) {
    return { ok: false, status: 422, detail: '用户名不能包含空格' }
  }
  if (username.length > USERNAME_LIMIT) {
    return { ok: false, status: 422, detail: '用户名最长 64 个字符' }
  }
  return { ok: true, body: { username } }
}

export function checkNewPassword(current: string, next: string): SecurityResult<{ password: string }> {
  if (Buffer.byteLength(next) > 72) {
    return { ok: false, status: 422, detail: '新密码最长 72 字节' }
  }
  if (next === current) {
    return { ok: false, status: 422, detail: '新密码需要和当前密码不同' }
  }
  return { ok: true, body: { password: next } }
}

export async function changeUsername(pool: Pool, current: string, requested: string): Promise<SecurityResult<{ username: string }>> {
  const cleaned = cleanUsername(requested)
  if (!cleaned.ok) return cleaned
  if (cleaned.body.username === current) return { ok: true, body: { username: current } }
  try {
    const result = await pool.query(
      'update accounts set username = $1 where username = $2',
      [cleaned.body.username, current],
    )
    if (result.rowCount === 0) return { ok: false, status: 401, detail: '未登录' }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === '23505') return { ok: false, status: 409, detail: '用户名已经存在' }
    throw error
  }
  return { ok: true, body: { username: cleaned.body.username } }
}

export async function changePassword(
  pool: Pool,
  account: SecurityAccount,
  currentPassword: string,
  newPassword: string,
): Promise<SecurityResult<{ ok: true }>> {
  if (!verifyPassword(currentPassword, account.password_hash)) {
    return { ok: false, status: 401, detail: '当前密码不正确' }
  }
  const checked = checkNewPassword(currentPassword, newPassword)
  if (!checked.ok) return checked
  const client = await pool.connect()
  try {
    await client.query('begin')
    await reencryptWallets(client, currentPassword, newPassword)
    await client.query(
      'update accounts set password_hash = $1 where username = $2',
      [hashPassword(newPassword), account.username],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    if (error instanceof VaultError) {
      return { ok: false, status: 409, detail: '钱包无法用当前密码解密，密码没有修改' }
    }
    throw error
  } finally {
    client.release()
  }
  return { ok: true, body: { ok: true } }
}

async function reencryptWallets(client: PoolClient, currentPassword: string, newPassword: string): Promise<void> {
  const rows = await client.query<{ id: string; ciphertext: string }>('select id, ciphertext from wallets')
  const opened: { id: string; mnemonic: string }[] = []
  for (const row of rows.rows) {
    opened.push({ id: row.id, mnemonic: await decryptMnemonic(currentPassword, row.ciphertext) })
  }
  for (const wallet of opened) {
    await client.query(
      'update wallets set ciphertext = $1 where id = $2',
      [await encryptMnemonic(newPassword, wallet.mnemonic), wallet.id],
    )
  }
}

export async function beginTotp(pool: Pool, account: SecurityAccount): Promise<SecurityResult<{ secret: string; otpauth_uri: string }>> {
  if (account.totp_enabled) return { ok: false, status: 409, detail: '两步验证已经开启' }
  const secret = newSecret()
  await pool.query('update accounts set totp_pending_secret = $1 where username = $2', [secret, account.username])
  return { ok: true, body: { secret, otpauth_uri: provisioningUri(secret, account.username) } }
}

export async function confirmTotp(pool: Pool, account: SecurityAccount, code: string): Promise<SecurityResult<{ ok: true }>> {
  if (account.totp_enabled) return { ok: false, status: 409, detail: '两步验证已经开启' }
  if (account.totp_pending_secret === null || !verifyTotp(account.totp_pending_secret, code)) {
    return { ok: false, status: 401, detail: '验证码不正确' }
  }
  await pool.query(
    `update accounts
     set totp_secret = totp_pending_secret, totp_pending_secret = null, totp_enabled = true
     where username = $1`,
    [account.username],
  )
  return { ok: true, body: { ok: true } }
}

export async function disableTotp(
  pool: Pool,
  account: SecurityAccount,
  password: string,
  code: string,
): Promise<SecurityResult<{ ok: true }>> {
  if (!account.totp_enabled || account.totp_secret === null) {
    return { ok: false, status: 409, detail: '两步验证没有开启' }
  }
  if (!verifyPassword(password, account.password_hash)) {
    return { ok: false, status: 401, detail: '密码不正确' }
  }
  if (!verifyTotp(account.totp_secret, code)) {
    return { ok: false, status: 401, detail: '验证码不正确' }
  }
  await pool.query(
    `update accounts
     set totp_enabled = false, totp_secret = null, totp_pending_secret = null
     where username = $1`,
    [account.username],
  )
  return { ok: true, body: { ok: true } }
}
