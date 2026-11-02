import { ServerError } from '../../shared/errors.ts'
import { type SoftwarePolicy } from '../../shared/policies.ts'
import { digest } from '../recipes/canonical.ts'
import { type TypeLease } from './model.ts'

export function parsePolicies(value: unknown): SoftwarePolicy[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 128) throw new ServerError('policy_invalid')
  const seen = new Set<string>()
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.software_key !== 'string' ||
      seen.has(item.software_key) ||
      typeof item.detect_updates !== 'boolean' ||
      !item.restriction ||
      typeof item.restriction !== 'object' ||
      !['any', 'exact', 'series', 'minimum', 'range'].includes(item.restriction.kind)
    )
      throw new ServerError('policy_invalid')
    seen.add(item.software_key)
    const rule = item.restriction
    const fields =
      rule.kind === 'series'
        ? ['prefix']
        : rule.kind === 'range'
          ? ['minimum', 'maximum']
          : ['exact', 'minimum'].includes(rule.kind)
            ? ['version']
            : []
    if (fields.some((key) => typeof rule[key] !== 'string' || rule[key].length > 128))
      throw new ServerError('policy_invalid')
    return {
      software_key: item.software_key,
      restriction: structuredClone(rule),
      detect_updates: item.detect_updates,
    }
  })
}
/** A user restriction may inherit the type, or narrow it. It cannot replace the provider's hard boundary. */
export function restrictLease(lease: TypeLease, policies: readonly SoftwarePolicy[]): TypeLease {
  if (policies.some((p) => !lease.components.some((c) => c.software_key === p.software_key)))
    throw new ServerError('policy_invalid')
  const components = lease.components.map((c) => {
    const rule =
      policies.find((p) => p.software_key === c.software_key)?.restriction ?? ({ kind: 'any' } as const)
    c.adapter.validate(rule)
    if (rule.kind !== 'any' && !c.adapter.isSubset(rule, c.versions))
      throw new ServerError('policy_widens_type')
    const versions = c.adapter.intersect([c.versions, rule])
    if (!versions) throw new ServerError('policy_widens_type')
    return { ...c, versions }
  })
  // Default policies preserve the existing definition signature; scheduling preferences are not recipe revisions.

  return {
    ...lease,
    components,
    signature: policySignature(lease.signature, policies),
    type: {
      ...lease.type,
      software: lease.type.software.map((s) => ({
        ...s,
        versions: components.find((c) => c.software_key === s.software_key)?.versions ?? s.versions,
      })),
    },
  }
}
export function detectionEligibility(
  component: TypeLease['components'][number],
  version: string,
): string | null {
  if (component.adapter.isSingleton(component.versions)) return 'fixed_version'
  if (component.adapter.atInclusiveUpperBound(component.versions, version)) return 'range_ceiling'
  return null
}

export function policySignature(definition: string, policies: readonly SoftwarePolicy[]): string {
  const ranges = policies
    .filter((p) => p.restriction.kind !== 'any')
    .sort((a, b) => a.software_key.localeCompare(b.software_key))
  return ranges.length
    ? digest({ definition, ranges: ranges.map((p) => ({ software: p.software_key, rule: p.restriction })) })
    : definition
}
