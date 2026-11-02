import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDomain, pickZone } from '../src/domain-name.ts'

test('normalizeDomain accepts bare names, schemes, paths and trailing dots', () => {
  assert.equal(normalizeDomain('example.com'), 'example.com')
  assert.equal(normalizeDomain('  Example.COM.  '), 'example.com')
  assert.equal(normalizeDomain('https://example.com/dns'), 'example.com')
  assert.equal(normalizeDomain('https://sub.example.com:8443/x?y=1'), 'sub.example.com')
})

test('normalizeDomain rejects names that are not domains', () => {
  assert.equal(normalizeDomain(''), undefined)
  assert.equal(normalizeDomain('localhost'), undefined)
  assert.equal(normalizeDomain('*.example.com'), undefined)
  assert.equal(normalizeDomain('example..com'), undefined)
  assert.equal(normalizeDomain('-example.com'), undefined)
  assert.equal(normalizeDomain('example .com'), undefined)
})

test('pickZone keeps only the exact zone name', () => {
  const zones = [{ name: 'example.com', id: 'a' }, { name: 'notexample.com', id: 'b' }]
  assert.equal(pickZone(zones, 'example.com')?.id, 'a')
  assert.equal(pickZone(zones, 'example.org'), undefined)
})
