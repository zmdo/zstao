import { ServerError } from './errors.ts'
export type VersionRule =
  | { kind: 'any' }
  | { kind: 'exact'; version: string }
  | { kind: 'series'; prefix: string }
  | { kind: 'minimum'; version: string }
  | { kind: 'range'; minimum: string; maximum: string }
export interface VersionAdapter {
  readonly revision: string
  normalize(version: string): string
  compare(left: string, right: string): -1 | 0 | 1
  validate(rule: VersionRule): void
  contains(rule: VersionRule, version: string): boolean
  isSubset(narrower: VersionRule, wider: VersionRule): boolean
  intersect(rules: readonly VersionRule[]): VersionRule | null
  isSingleton(rule: VersionRule): boolean
  atInclusiveUpperBound(rule: VersionRule, version: string): boolean
  isMajorChange(from: string, to: string): boolean
}

type Triple = [number, number, number]
function parts(value: string, full = false): number[] {
  if (
    !(full ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,2}$/).test(value)
  )
    throw new ServerError('version_invalid')
  const result = value.split('.').map(Number)
  if (result.some((item) => !Number.isSafeInteger(item) || item >= Number.MAX_SAFE_INTEGER))
    throw new ServerError('version_invalid')
  return result
}
const cmp = (a: readonly number[], b: readonly number[]): -1 | 0 | 1 => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return 0
}
const lower = (v: string): Triple => {
  const p = parts(v)
  return [p[0]!, p[1] ?? 0, p[2] ?? 0]
}
const upper = (v: string): Triple => {
  const p = parts(v)
  return [p[0]!, p[1] ?? Number.MAX_SAFE_INTEGER, p[2] ?? Number.MAX_SAFE_INTEGER]
}
function bounds(rule: VersionRule): [Triple, Triple] {
  let result: [Triple, Triple]
  switch (rule.kind) {
    case 'any':
      return [
        [0, 0, 0],
        [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      ]
    case 'exact':
      parts(rule.version, true)
      return [lower(rule.version), lower(rule.version)]
    case 'series':
      if (parts(rule.prefix).length === 3) throw new ServerError('version_invalid')
      return [lower(rule.prefix), upper(rule.prefix)]
    case 'minimum':
      return [lower(rule.version), bounds({ kind: 'any' })[1]]
    case 'range':
      result = [lower(rule.minimum), upper(rule.maximum)]
      break
  }
  if (cmp(result[0], result[1]) > 0) throw new ServerError('version_invalid')
  return result
}
export const stableVersions: VersionAdapter = Object.freeze({
  revision: 'semver-stable-1',
  normalize(value: string) {
    parts(value, true)
    return value
  },
  compare(a: string, b: string) {
    parts(a, true)
    parts(b, true)
    return cmp(lower(a), lower(b))
  },
  validate(rule: VersionRule) {
    bounds(rule)
  },
  contains(rule: VersionRule, value: string) {
    const [lo, hi] = bounds(rule)
    parts(value, true)
    return cmp(lower(value), lo) >= 0 && cmp(lower(value), hi) <= 0
  },
  isSubset(a: VersionRule, b: VersionRule) {
    const [al, ah] = bounds(a),
      [bl, bh] = bounds(b)
    return cmp(al, bl) >= 0 && cmp(ah, bh) <= 0
  },
  intersect(rules: readonly VersionRule[]): VersionRule | null {
    let [lo, hi] = bounds({ kind: 'any' })
    for (const rule of rules) {
      const [a, b] = bounds(rule)
      if (cmp(a, lo) > 0) lo = a
      if (cmp(b, hi) < 0) hi = b
    }
    if (cmp(lo, hi) > 0) return null
    if (cmp(lo, hi) === 0) return { kind: 'exact', version: lo.join('.') }
    if (hi[0] === Number.MAX_SAFE_INTEGER)
      return lo.every((v) => v === 0) ? { kind: 'any' } : { kind: 'minimum', version: lo.join('.') }
    return {
      kind: 'range',
      minimum: lo.join('.'),
      maximum: hi.filter((v) => v !== Number.MAX_SAFE_INTEGER).join('.'),
    }
  },
  isSingleton(rule: VersionRule) {
    const [a, b] = bounds(rule)
    return cmp(a, b) === 0
  },
  atInclusiveUpperBound(rule: VersionRule, value: string) {
    parts(value, true)
    return cmp(lower(value), bounds(rule)[1]) === 0
  },
  isMajorChange(a: string, b: string) {
    return parts(a, true)[0] !== parts(b, true)[0]
  },
})
