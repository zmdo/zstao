import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const VERSION = 0x80
const IV_LENGTH = 16
const HMAC_LENGTH = 32
const HEADER_LENGTH = 1 + 8 + IV_LENGTH

/** Fernet rejected the token or the key does not match the one that wrote it. */
export class SecretError extends Error {
  readonly code = 'undecryptable'

  constructor(cause: unknown) {
    super('无法解密，加密主密钥与写入时不一致。', { cause })
    this.name = 'SecretError'
  }
}

/** Decode a Python Fernet key. The raw key is 32 bytes: signing key, then encryption key. */
export function decodeFernetKey(encoded: string): Buffer {
  const key = Buffer.from(encoded.trim(), 'base64url')
  if (key.length !== 32) {
    throw new Error('encryptionKey 必须是 32 字节的 Fernet 密钥')
  }
  return key
}

/** Encrypt and decrypt text with the same token format as Python's Fernet. */
export class SecretsCodec {
  private readonly signingKey: Buffer
  private readonly encryptionKey: Buffer

  constructor(key: Buffer) {
    this.signingKey = key.subarray(0, 16)
    this.encryptionKey = key.subarray(16)
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv('aes-128-cbc', this.encryptionKey, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const header = Buffer.alloc(HEADER_LENGTH)
    header[0] = VERSION
    header.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 1)
    header.set(iv, 9)
    const signed = Buffer.concat([header, ciphertext])
    const mac = createHmac('sha256', this.signingKey).update(signed).digest()
    return Buffer.concat([signed, mac]).toString('base64').replaceAll('+', '-').replaceAll('/', '_')
  }

  decrypt(token: string): string {
    try {
      const body = Buffer.from(token, 'base64url')
      if (body.length < HEADER_LENGTH + 16 + HMAC_LENGTH || body[0] !== VERSION) {
        throw new Error('token header')
      }
      const signed = body.subarray(0, body.length - HMAC_LENGTH)
      const mac = body.subarray(body.length - HMAC_LENGTH)
      const expected = createHmac('sha256', this.signingKey).update(signed).digest()
      if (!timingSafeEqual(mac, expected)) {
        throw new Error('token mac')
      }
      const iv = signed.subarray(9, 25)
      const decipher = createDecipheriv('aes-128-cbc', this.encryptionKey, iv)
      return Buffer.concat([decipher.update(signed.subarray(HEADER_LENGTH)), decipher.final()]).toString('utf8')
    } catch (cause) {
      if (cause instanceof SecretError) throw cause
      throw new SecretError(cause)
    }
  }
}
