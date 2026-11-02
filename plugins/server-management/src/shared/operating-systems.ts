import { ServerError } from './errors.ts'
import type { DeclaredOs, DetectedOs, OsSelector, OsSupport } from './operating-system-types.ts'
export interface OsRelease {
  key: string
  version: string
  precision: 'release' | 'series'
  name: string
}
export interface OsFamily {
  key: string
  name: string
  releases: readonly OsRelease[]
}
export type { DeclaredOs, DetectedOs, OsSelector, OsSupport } from './operating-system-types.ts'
const releases = (
  name: string,
  versions: readonly string[],
  precision: 'release' | 'series' = 'release',
): OsRelease[] =>
  versions.map((version) => ({
    key: version,
    version,
    precision,
    name: `${name} ${version}${name === 'Ubuntu' ? ' LTS' : ''}`,
  }))

/** Selection catalogue only; availability here does not authorize an installer. */
export const OS_CATALOG: readonly OsFamily[] = [
  {
    key: 'builtin/windows-server',
    name: 'Windows Server',
    releases: releases('Windows Server', ['2016', '2019', '2022', '2025']),
  },
  {
    key: 'builtin/ubuntu',
    name: 'Ubuntu',
    releases: releases('Ubuntu', ['20.04', '22.04', '24.04', '26.04']),
  },
  { key: 'builtin/debian', name: 'Debian', releases: releases('Debian', ['12', '13'], 'series') },
  ...['rhel', 'rocky', 'almalinux'].map((key, index) => ({
    key: `builtin/${key}`,
    name: ['Red Hat Enterprise Linux', 'Rocky Linux', 'AlmaLinux'][index]!,
    releases: releases(
      ['Red Hat Enterprise Linux', 'Rocky Linux', 'AlmaLinux'][index]!,
      ['8', '9', '10'],
      'series',
    ),
  })),
]

/** Current apt recipes are confined to these releases and CPU architectures. */
export const APT_SOFTWARE_OS: readonly OsSelector[] = [
  ...['22.04', '24.04'].map((version) => ({
    family: 'builtin/ubuntu',
    versions: { kind: 'release' as const, version },
    architectures: ['x86_64', 'aarch64'],
  })),
  ...['12', '13'].map((prefix) => ({
    family: 'builtin/debian',
    versions: { kind: 'series' as const, prefix },
    architectures: ['x86_64', 'aarch64'],
  })),
]

export function parseDeclaredOs(value: unknown, previous?: DeclaredOs): DeclaredOs {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ServerError('os_required')
  const input = value as Record<string, unknown>
  if (
    input.kind === 'custom' &&
    typeof input.text === 'string' &&
    input.text.trim().length > 0 &&
    input.text.trim().length <= 200
  )
    return { kind: 'custom', text: input.text.trim() }
  if (input.kind === 'catalog') {
    const family = OS_CATALOG.find((item) => item.key === input.family)
    const release = family?.releases.find((item) => item.key === input.releaseKey)
    if (family && release)
      return {
        kind: 'catalog',
        family: family.key,
        releaseKey: release.key,
        version: release.version,
        precision: release.precision,
        name: release.name,
      }
    if (
      previous?.kind === 'catalog' &&
      previous.family === input.family &&
      previous.releaseKey === input.releaseKey
    )
      return previous
  }
  throw new ServerError('os_invalid')
}

export function osLabel(os: DeclaredOs): string {
  return os.kind === 'custom' ? os.text : os.name
}

export function declaredOsFromDetected(os: DetectedOs): DeclaredOs {
  const family = OS_CATALOG.find((item) => item.key === os.family)
  const release = family?.releases.find((item) =>
    matchesSelector(os, {
      family: family.key,
      versions:
        item.precision === 'series'
          ? { kind: 'series', prefix: item.version }
          : { kind: 'release', version: item.version },
    }),
  )
  return family && release
    ? {
        kind: 'catalog',
        family: family.key,
        releaseKey: release.key,
        version: release.version,
        precision: release.precision,
        name: release.name,
      }
    : { kind: 'custom', text: `${family?.name ?? os.family.replace(/^builtin\//, '')} ${os.version}` }
}

export function sameDeclaredOs(left: DeclaredOs, right: DeclaredOs): boolean {
  if (left.kind === 'custom') return right.kind === 'custom' && left.text === right.text
  return (
    right.kind === 'catalog' &&
    left.family === right.family &&
    left.releaseKey === right.releaseKey &&
    left.version === right.version &&
    left.precision === right.precision
  )
}

function parts(value: string): number[] {
  if (!/^\d+(?:\.\d+)*$/.test(value)) throw new ServerError('os_definition_invalid')
  const result = value.split('.').map(Number)
  if (result.some((item) => !Number.isSafeInteger(item))) throw new ServerError('os_definition_invalid')
  return result
}

function compare(left: string, right: string): number {
  const a = parts(left),
    b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const result = (a[index] ?? 0) - (b[index] ?? 0)
    if (result !== 0) return Math.sign(result)
  }
  return 0
}

export function matchesSelector(
  os: { family: string; version: string; architecture?: string },
  selector: OsSelector,
): boolean {
  if (
    os.family !== selector.family ||
    (os.architecture !== undefined &&
      selector.architectures !== undefined &&
      !selector.architectures.includes(os.architecture))
  )
    return false
  const rule = selector.versions
  switch (rule.kind) {
    case 'any':
      return true
    case 'release':
      return os.version === rule.version
    case 'series':
      return os.version === rule.prefix || os.version.startsWith(`${rule.prefix}.`)
    case 'range':
      return compare(os.version, rule.minimum) >= 0 && compare(os.version, rule.maximum) <= 0
  }
}

export function supportsOs(support: OsSupport, os: DeclaredOs | DetectedOs): boolean {
  if (support.kind === 'all') return true
  if ('kind' in os && os.kind === 'custom') return false
  if ('kind' in os && os.precision === 'series') {
    const lower = parts(os.version),
      upper = [...lower]
    upper[upper.length - 1]! += 1
    return support.selectors.some((selector) => {
      if (selector.family !== os.family) return false
      const rule = selector.versions
      switch (rule.kind) {
        case 'any':
          return true
        case 'release':
          return compare(rule.version, lower.join('.')) >= 0 && compare(rule.version, upper.join('.')) < 0
        case 'series':
          return (
            rule.prefix === os.version ||
            rule.prefix.startsWith(`${os.version}.`) ||
            os.version.startsWith(`${rule.prefix}.`)
          )
        case 'range':
          return compare(rule.maximum, lower.join('.')) >= 0 && compare(rule.minimum, upper.join('.')) < 0
      }
    })
  }
  return support.selectors.some((selector) => matchesSelector(os, selector))
}

export function osVerification(
  declared: DeclaredOs,
  detected: DetectedOs | null,
  state: string,
): 'unverified' | 'matched' | 'mismatch' | 'custom' {
  if (declared.kind === 'custom') return 'custom'
  if (state !== 'detected' || detected === null) return 'unverified'
  return matchesSelector(detected, {
    family: declared.family,
    versions:
      declared.precision === 'series'
        ? { kind: 'series', prefix: declared.version }
        : { kind: 'release', version: declared.version },
  })
    ? 'matched'
    : 'mismatch'
}

export function validateOsSupport(support: OsSupport, hasSoftware: boolean): void {
  if (support.kind === 'all') {
    if (hasSoftware) throw new ServerError('os_definition_invalid')
    return
  }
  if (support.selectors.length === 0) throw new ServerError('os_definition_invalid')
  for (const selector of support.selectors) {
    // Current scripts use sh. Windows/custom adapters arrive with the V2 recipe executor.
    if (
      !OS_CATALOG.some((item) => item.key === selector.family) ||
      (hasSoftware && selector.family === 'builtin/windows-server')
    )
      throw new ServerError('os_definition_invalid')
    if (selector.architectures?.length === 0) throw new ServerError('os_definition_invalid')
    switch (selector.versions.kind) {
      case 'any':
        break
      case 'release':
        parts(selector.versions.version)
        break
      case 'series':
        parts(selector.versions.prefix)
        break
      case 'range':
        if (compare(selector.versions.minimum, selector.versions.maximum) > 0)
          throw new ServerError('os_definition_invalid')
        break
    }
  }
}
