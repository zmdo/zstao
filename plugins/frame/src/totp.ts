import { randomBytes } from 'node:crypto'
import { createHmac } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function decodeBase32(input: string): Buffer {
  const cleaned = input.replace(/=+$/u, '').replace(/ /gu, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) throw new Error('base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
    }
  }
  return Buffer.from(out)
}

function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', key).update(message).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const binary = ((mac[offset]! & 0x7f) << 24)
    | (mac[offset + 1]! << 16)
    | (mac[offset + 2]! << 8)
    | mac[offset + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}

/** Accept the current 30-second code and one step on either side, matching the existing login. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const cleaned = code.trim().replace(/ /gu, '')
  if (!/^\d{6}$/u.test(cleaned)) return false
  let key: Buffer
  try {
    key = decodeBase32(secret)
  } catch (error) {
    void error
    return false
  }
  const counter = Math.floor(now / 30_000)
  for (const offset of [-1, 0, 1]) {
    if (hotp(key, counter + offset) === cleaned) return true
  }
  return false
}

/** 20 random bytes, the same length pyotp uses for a new authenticator secret. */
export function newSecret(): string {
  return encodeBase32(randomBytes(20))
}

/** otpauth URI the existing authenticator apps already accept. */
export function provisioningUri(secret: string, username: string): string {
  const issuer = '策略控制台'
  const label = encodeURIComponent(`${issuer}:${username}`)
  const query = new URLSearchParams({ secret, issuer })
  return `otpauth://totp/${label}?${query.toString()}`
}

function encodeBase32(input: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(value >> bits) & 31]
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}
