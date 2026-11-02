import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeFernetKey, SecretError, SecretsCodec } from '../src/fernet.ts'

const KEY = 'DJgTLH4djm-MziO9AWRlGWIuSCWSvj4Vdp8C1PDhZuw='
const TOKEN = 'gAAAAABq0qbrZ3vpgJas9lYesmfEqGw67yy82_iW2laNiv_52nIviWeOaoph5r7FlPws-MO3YrmoAfxUoNsBTvGNqTYR4H8B4P7JRHmdLkr9lp242_IVFFG0FzPJhQnPatWnupPTCPsV'
const PLAINTEXT = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest'

test('a token written by Python Fernet decrypts', () => {
  const codec = new SecretsCodec(decodeFernetKey(KEY))
  assert.equal(codec.decrypt(TOKEN), PLAINTEXT)
})

test('a token this process writes decrypts with the same key', () => {
  const codec = new SecretsCodec(decodeFernetKey(KEY))
  assert.equal(codec.decrypt(codec.encrypt(PLAINTEXT)), PLAINTEXT)
})

test('a token written for another key is rejected', () => {
  const codec = new SecretsCodec(decodeFernetKey(KEY))
  const other = new SecretsCodec(Buffer.alloc(32, 7))
  assert.throws(() => codec.decrypt(other.encrypt('secret')), (error: unknown) => {
    assert.ok(error instanceof SecretError)
    assert.equal(error.code, 'undecryptable')
    return true
  })
})

test('encryptionKey must be a 32-byte Fernet key', () => {
  assert.throws(() => decodeFernetKey('short'), /Fernet/)
})
