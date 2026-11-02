import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { encryptionKeyError } from '../src/key.ts'
import {
  clearInstallDisabled,
  clearStoreCredentials,
  installDisabled,
  storeCredentials,
  writeInstallPatch,
} from '../src/patch.ts'

const sample = `[]
`

test('a Fernet key is 32 bytes', () => {
  assert.equal(encryptionKeyError(''), '加密密钥格式不对')
  assert.equal(encryptionKeyError(randomBytes(32).toString('base64url')), undefined)
})

test('writing credentials keeps the other rows and disables install', () => {
  const source = `
- id: smp-frame
  config:
    sessionSecret: keep-me
- id: locale
  name: '@deepseek-ai/dsh-client-locale'
  config:
    preference: !!js "'zh'"
`
  const next = writeInstallPatch(source, {
    credentials: { databaseUrl: 'postgresql://db.example/smp', encryptionKey: 'key-value' },
    disable: true,
  })
  assert.equal(storeCredentials(next)?.databaseUrl, 'postgresql://db.example/smp')
  assert.equal(storeCredentials(next)?.encryptionKey, 'key-value')
  assert.equal(installDisabled(next), true)
  assert.match(next, /sessionSecret: keep-me/)
  assert.match(next, /!!js/)
  const cleared = clearStoreCredentials(clearInstallDisabled(next))
  assert.equal(storeCredentials(cleared), undefined)
  assert.equal(installDisabled(cleared), false)
  assert.match(cleared, /sessionSecret: keep-me/)
  assert.match(cleared, /!!js/)
})

test('disabling install does not invent store credentials', () => {
  const next = writeInstallPatch(sample, { disable: true })
  assert.equal(storeCredentials(next), undefined)
  assert.equal(installDisabled(next), true)
})

test('blank store fields count as missing', () => {
  const source = `
- id: smp-database
  config:
    databaseUrl: ''
    encryptionKey: 'present'
`
  assert.equal(storeCredentials(source), undefined)
})
