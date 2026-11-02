import assert from 'node:assert/strict'
import test from 'node:test'
import { decideLogin, passwordIsDefault } from '../src/account.ts'
import { hashPassword } from '../src/password.ts'
import { clearSessionCookie, openSession, sealSession } from '../src/session.ts'
import { createSection } from '../src/section.ts'
import { verifyTotp } from '../src/totp.ts'

const SECRET = 'session-secret'

test('a sealed session opens as the same user until it expires', () => {
  const now = Date.parse('2026-10-17T00:00:00Z')
  const token = sealSession('admin', SECRET, now)
  assert.equal(openSession(token, SECRET, now + 1000), 'admin')
  assert.equal(openSession(token, 'other-secret', now + 1000), undefined)
  assert.equal(openSession(`${token}x`, SECRET, now + 1000), undefined)
  assert.equal(openSession(token, SECRET, now + 15 * 24 * 3600 * 1000), undefined)
})

test('logout clears the session cookie', () => {
  assert.match(clearSessionCookie(), /^smp_session=; Max-Age=0; Path=\/; /)
})

test('login accepts the password and asks for a code when totp is on', () => {
  const passwordHash = hashPassword('correct')
  const account = { username: 'admin', password_hash: passwordHash, totp_enabled: false, totp_secret: null }
  assert.deepEqual(decideLogin(account, 'correct', undefined), { kind: 'ok', username: 'admin' })
  assert.equal(decideLogin(account, 'wrong', undefined).kind, 'unauthorized')
  assert.equal(decideLogin(undefined, 'correct', undefined).kind, 'unauthorized')
  const protectedAccount = { ...account, totp_enabled: true, totp_secret: 'JBSWY3DPEHPK3PXP' }
  assert.equal(decideLogin(protectedAccount, 'correct', undefined).kind, 'totp')
  assert.equal(decideLogin(protectedAccount, 'correct', '000000').kind, 'unauthorized')
  assert.equal(passwordIsDefault(hashPassword('changeme')), true)
  assert.equal(passwordIsDefault(passwordHash), false)
})

test('the current totp step is accepted', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  assert.equal(verifyTotp(secret, '287082', 59_000), true)
  assert.equal(verifyTotp(secret, '000000', 59_000), false)
})

test('each apply owns its selected column', () => {
  const first = createSection()
  const second = createSection()
  let seen = 0
  first.subscribe(() => { seen += 1 })
  first.set('servers')
  assert.equal(first.get(), 'servers')
  assert.equal(second.get(), 'settings')
  assert.equal(seen, 1)
  first.set('servers')
  assert.equal(seen, 1)
})
