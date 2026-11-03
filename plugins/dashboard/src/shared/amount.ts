import type { Currency } from './contracts.ts'

const SCALE: Record<Currency, number> = { CNY: 2, USD: 2 }

export function isCurrency(value: unknown): value is Currency {
  return value === 'CNY' || value === 'USD'
}

export function parseDecimal(value: string, currency: Currency): bigint {
  const text = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('invalid_amount')
  const [whole, fraction = ''] = text.split('.')
  const scale = SCALE[currency]
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0').slice(0, scale))
}

export function decimalFromMinor(value: bigint, currency: Currency): string {
  const scale = SCALE[currency]
  const negative = value < 0n
  const absolute = negative ? -value : value
  const divisor = 10n ** BigInt(scale)
  const whole = absolute / divisor
  const fraction = (absolute % divisor).toString().padStart(scale, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export function convertMinor(value: bigint, from: Currency, to: Currency, rate: number): bigint {
  if (from === to) return value
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('invalid_rate')
  const sourceScale = SCALE[from]
  const targetScale = SCALE[to]
  const raw = (Number(value) / 10 ** sourceScale) * rate * 10 ** targetScale
  return BigInt(Math.round(raw))
}

export function money(value: bigint | string, currency: Currency, locale = 'zh-CN'): string {
  const minor = typeof value === 'string' ? BigInt(value) : value
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(minor) / 100)
}

export function compactMoney(value: bigint | string, currency: Currency, locale = 'zh-CN'): string {
  const minor = typeof value === 'string' ? BigInt(value) : value
  const amount = Number(minor) / 100
  const absolute = Math.abs(amount)
  if (absolute >= 1_000_000) return `${currency === 'CNY' ? '¥' : '$'}${(amount / 1_000_000).toFixed(1)}m`
  if (absolute >= 1_000) return `${currency === 'CNY' ? '¥' : '$'}${(amount / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

export function formatAmount(value: string, currency: Currency, locale = 'zh-CN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value))
}
