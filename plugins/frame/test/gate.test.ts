import assert from 'node:assert/strict'
import test from 'node:test'
import { clearDshCookieHeaders, dshAuthCookieNames, indexGate, smpSessionValue, tokenExchangeUrl } from '../src/gate.ts'

test('a console session without a page connection mints one', () => {
  assert.equal(indexGate(false, false), 'login')
  assert.equal(indexGate(false, true), 'login')
  assert.equal(indexGate(true, true), 'app')
  assert.equal(indexGate(true, false), 'mint')
})

test('session and page-connection cookies are read separately', () => {
  const header = 'smp_session=abc; dsh-auth-one=v1; other=no; dsh-auth-two=v2'
  assert.equal(smpSessionValue(header), 'abc')
  assert.deepEqual(dshAuthCookieNames(header), ['dsh-auth-one', 'dsh-auth-two'])
  assert.equal(smpSessionValue(''), undefined)
  assert.equal(smpSessionValue('smp_session='), undefined)
})

test('clearing a page-connection cookie expires it at the site root', () => {
  const [header] = clearDshCookieHeaders(['dsh-auth-one'])
  assert.match(header, /^dsh-auth-one=; Max-Age=0; Path=\/; /)
  assert.match(header, /HttpOnly; SameSite=Strict$/)
})

test('the exchange url carries only the process token', () => {
  assert.equal(tokenExchangeUrl('/?token=old&x=1', 'fresh'), '/?x=1&token=fresh')
  assert.equal(tokenExchangeUrl('', 'fresh'), '/?token=fresh')
})
