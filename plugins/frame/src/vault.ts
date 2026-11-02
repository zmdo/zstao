import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { argon2id } from 'hash-wasm'

const MEMORY_KIB = 65_536
const TIME_COST = 3
const PARALLELISM = 1
const KEY_LENGTH = 32

export class VaultError extends Error {
  override readonly name = 'VaultError'
}

interface VaultPayload {
  v?: unknown
  m?: unknown
  t?: unknown
  p?: unknown
  salt?: unknown
  nonce?: unknown
  ct?: unknown
}

async function derive(password: string, salt: Uint8Array, memory: number, time: number, parallelism: number): Promise<Buffer> {
  const key = await argon2id({
    password,
    salt,
    parallelism,
    iterations: time,
    memorySize: memory,
    hashLength: KEY_LENGTH,
    outputType: 'binary',
  })
  return Buffer.from(key)
}

/** Encrypt a mnemonic the way the existing wallet rows are stored. */
export async function encryptMnemonic(password: string, mnemonic: string): Promise<string> {
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const key = await derive(password, salt, MEMORY_KIB, TIME_COST, PARALLELISM)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return JSON.stringify({
    v: 1,
    kdf: 'argon2id',
    m: MEMORY_KIB,
    t: TIME_COST,
    p: PARALLELISM,
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    ct: body.toString('base64'),
  })
}

export async function decryptMnemonic(password: string, ciphertext: string): Promise<string> {
  let payload: VaultPayload
  try {
    payload = JSON.parse(ciphertext) as VaultPayload
  } catch (error) {
    throw new VaultError('钱包无法用当前密码解密', { cause: error })
  }
  if (typeof payload.salt !== 'string' || typeof payload.nonce !== 'string' || typeof payload.ct !== 'string') {
    throw new VaultError('钱包无法用当前密码解密')
  }
  if (typeof payload.m !== 'number' || typeof payload.t !== 'number' || typeof payload.p !== 'number') {
    throw new VaultError('钱包无法用当前密码解密')
  }
  try {
    const salt = Buffer.from(payload.salt, 'base64')
    const nonce = Buffer.from(payload.nonce, 'base64')
    const packed = Buffer.from(payload.ct, 'base64')
    const tag = packed.subarray(packed.length - 16)
    const data = packed.subarray(0, packed.length - 16)
    const key = await derive(password, salt, payload.m, payload.t, payload.p)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch (error) {
    throw new VaultError('钱包无法用当前密码解密', { cause: error })
  }
}
