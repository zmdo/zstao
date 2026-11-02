import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { encryptionKeyError } from '../src/key.ts'
import { encryptionKey, writeEncryptionKey } from '../src/patch.ts'

test('a Fernet key is 32 bytes', () => {
  assert.equal(encryptionKeyError(''), '加密密钥格式不对')
  assert.equal(encryptionKeyError(randomBytes(32).toString('base64url')), undefined)
})

test('replacing the encryption key keeps the database URL and other rows', () => {
  const source = `
- id: smp-database
  config:
    databaseUrl: postgresql://db.example/smp
    encryptionKey: old-key
- id: locale
  config:
    preference: !!js "'zh'"
`
  const next = writeEncryptionKey(source, 'new-key')
  assert.equal(typeof next, 'string')
  if (next === undefined) return
  assert.equal(encryptionKey(next), 'new-key')
  assert.match(next, /postgresql:\/\/db\.example\/smp/)
  assert.match(next, /!!js/)
  assert.doesNotMatch(next, /old-key/)
})
