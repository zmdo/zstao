import type { PackageIdentity } from '../../shared/contracts/recipes.ts'
import type { DetectedOs } from '../../shared/operating-systems.ts'
import { componentRevision, type Component } from '../definitions/catalog.ts'
import { excerpt } from '../remote/parse.ts'
import { type CommandResult, type SshSession } from '../remote/ssh.ts'
import { observe } from './planning.ts'

export interface SoftwareProbe {
  state: 'installed' | 'missing' | 'unknown'
  installed: boolean
  detail: string
  version?: string
  revision?: string
  targetIdentity?: string
  healthy?: boolean
  packages?: readonly PackageIdentity[]
}

export type SoftwareStatus = Record<string, SoftwareProbe>


function probe(state: SoftwareProbe['state'], detail = '', version?: string): SoftwareProbe {
  return {
    state,
    installed: state === 'installed',
    detail: detail.slice(-500),
    ...(version === undefined ? {} : { version }),
  }
}

export function parseSoftwareProbe(result: CommandResult): SoftwareProbe {
  if (result.code !== 0) return probe('unknown', excerpt(result.stderr || result.stdout))
  let value: unknown
  try {
    value = JSON.parse(result.stdout.trim())
  } catch (cause) {
    void cause
    return probe('unknown', excerpt(result.stdout || result.stderr))
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return probe('unknown')
  const record = value as { state?: unknown; detail?: unknown; version?: unknown }
  if (record.state !== 'installed' && record.state !== 'missing' && record.state !== 'unknown')
    return probe('unknown')
  if (record.state === 'installed' && (typeof record.version !== 'string' || record.version.trim() === ''))
    return probe('unknown', 'Installed software did not report a version.')
  return probe(
    record.state,
    typeof record.detail === 'string' ? record.detail : '',
    typeof record.version === 'string' ? record.version.slice(0, 128) : undefined,
  )
}

export async function detectSoftware(
  session: SshSession,
  components: readonly Component[],
  os: DetectedOs,
): Promise<SoftwareStatus> {
  const result: SoftwareStatus = {}
  for (const component of components) {
    const value = await observe(session, component, os)
    result[component.id] = {
      ...value,
      installed: value.state === 'installed',
      detail: 'detail' in value ? (value.detail ?? '') : '',
      revision: componentRevision(component),
    }
  }
  return result
}
