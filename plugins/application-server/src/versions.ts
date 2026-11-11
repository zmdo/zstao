import type { VersionAdapter, VersionRule } from '@smp/console-server-management/contracts'

// OpenResty has four numeric components; dropping the fourth hides patch releases.
const ceiling = Number.MAX_SAFE_INTEGER
const invalid = () => Object.assign(new Error('Invalid OpenResty version rule'), { code: 'version_invalid' })
function parts(value: string, full = false): number[] {
  if (!(full ? /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){3}$/ : /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/).test(value)) throw invalid()
  const values = value.split('.').map(Number)
  if (values.some(value => !Number.isSafeInteger(value) || value >= ceiling)) throw invalid()
  return values
}
const compare = (a: number[], b: number[]): -1 | 0 | 1 => {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return 0
}
function padded(value: string, fill: number): number[] {
  const values = parts(value)
  return [...values, ...Array<number>(4 - values.length).fill(fill)]
}
function bounds(rule: VersionRule): [number[], number[]] {
  switch (rule.kind) {
    case 'any': return [Array(4).fill(0), Array(4).fill(ceiling)]
    case 'exact': {
      const value = parts(rule.version, true)
      return [value, value]
    }
    case 'series':
      if (parts(rule.prefix).length === 4) throw invalid()
      return [padded(rule.prefix, 0), padded(rule.prefix, ceiling)]
    case 'minimum': return [padded(rule.version, 0), Array(4).fill(ceiling)]
    case 'range': {
      const low = padded(rule.minimum, 0), high = padded(rule.maximum, ceiling)
      if (compare(low, high) > 0) throw invalid()
      return [low, high]
    }
  }
}
export const openRestyVersions: VersionAdapter = Object.freeze({
  revision: 'openresty-four-part-1',
  normalize(value: string) { parts(value, true); return value },
  compare(a: string, b: string) { return compare(parts(a, true), parts(b, true)) },
  validate(rule: VersionRule) { bounds(rule) },
  contains(rule: VersionRule, version: string) {
    const [low, high] = bounds(rule), value = parts(version, true)
    return compare(value, low) >= 0 && compare(value, high) <= 0
  },
  isSubset(narrower: VersionRule, wider: VersionRule) {
    const [low, high] = bounds(narrower), [outerLow, outerHigh] = bounds(wider)
    return compare(low, outerLow) >= 0 && compare(high, outerHigh) <= 0
  },
  intersect(rules: readonly VersionRule[]): VersionRule | null {
    let [low, high] = bounds({ kind: 'any' })
    for (const rule of rules) {
      const [a, b] = bounds(rule)
      if (compare(a, low) > 0) low = a
      if (compare(b, high) < 0) high = b
    }
    if (compare(low, high) > 0) return null
    if (compare(low, high) === 0) return { kind: 'exact', version: low.join('.') }
    if (high[0] === ceiling) return low.every(value => value === 0)
      ? { kind: 'any' } : { kind: 'minimum', version: low.join('.') }
    return { kind: 'range', minimum: low.join('.'), maximum: high.filter(value => value !== ceiling).join('.') }
  },
  isSingleton(rule: VersionRule) { const [low, high] = bounds(rule); return compare(low, high) === 0 },
  atInclusiveUpperBound(rule: VersionRule, version: string) { return compare(parts(version, true), bounds(rule)[1]) === 0 },
  isMajorChange(a: string, b: string) { return parts(a, true)[0] !== parts(b, true)[0] },
})
