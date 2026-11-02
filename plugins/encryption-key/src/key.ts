/** Decode check shared with the store plugin. The raw Fernet key is 32 bytes. */
export function encryptionKeyError(encoded: string): string | undefined {
  const key = Buffer.from(encoded.trim(), 'base64url')
  if (key.length !== 32) return '加密密钥格式不对'
  return undefined
}
