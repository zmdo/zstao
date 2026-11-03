import assert from 'node:assert/strict'
import test from 'node:test'
import { convertMinor, decimalFromMinor, formatAmount, parseDecimal } from '../src/shared/amount.ts'

test('decimal amounts round-trip through minor units', () => {
  assert.equal(parseDecimal('0.01', 'CNY'), 1n)
  assert.equal(parseDecimal('1280.50', 'CNY'), 128050n)
  assert.equal(decimalFromMinor(128050n, 'CNY'), '1280.50')
  assert.equal(decimalFromMinor(-42n, 'USD'), '-0.42')
})

test('invalid decimal amounts fail instead of coercing', () => {
  assert.throws(() => parseDecimal('1.001', 'CNY'))
  assert.throws(() => parseDecimal('-1.00', 'CNY'))
  assert.throws(() => parseDecimal('NaN', 'CNY'))
})

test('conversion uses the target currency scale', () => {
  assert.equal(convertMinor(100n, 'USD', 'CNY', 7.2), 720n)
  assert.equal(convertMinor(720n, 'CNY', 'USD', 1 / 7.2), 100n)
})

test('formatAmount keeps two decimals for summary values', () => {
  assert.equal(formatAmount('1280.50', 'CNY', 'en-US'), 'CN¥1,280.50')
})
