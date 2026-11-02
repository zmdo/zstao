import { type PreparedPlan } from '../../shared/changes.ts'
import { ServerError } from '../../shared/errors.ts'
import { type TypeLease } from '../definitions/model.ts'
import { environment } from '../recipes/planning.ts'
import { quote } from '../recipes/script.ts'
import { type SshSession } from './ssh.ts'
import { REMOTE_SUPERVISOR } from './supervisor.ts'

export interface RemoteResult {
  state: 'not-started' | 'running' | 'completed' | 'failed' | 'unknown'
  steps: Array<{ ordinal: number; software: string; state: string; changes: unknown[]; after?: unknown }>
  error?: string
}
export async function remoteOperation(
  session: SshSession,
  operation: 'start' | 'recover',
  operationId: string,
  digest: string,
  plan?: PreparedPlan,
  lease?: TypeLease,
): Promise<RemoteResult> {
  const steps =
    operation === 'start'
      ? plan!.changes.map((change, index) => {
          const component = lease!.components[index]!
          return {
            environment: environment(component, plan!.os),
            request: { ...environment(component, plan!.os), operationId, planDigest: digest, change },
            detect: component.scripts.detect,
            execute: component.scripts.execute,
            verify: component.scripts.verify,
          }
        })
      : undefined
  const command = `${'sudo -n '}python3 -c ${quote(REMOTE_SUPERVISOR)}`
  // Root hosts do not necessarily have sudo installed.
  const result = await session.exec(
    `if [ "$(id -u)" = 0 ]; then python3 -c ${quote(REMOTE_SUPERVISOR)}; else ${command}; fi`,
    30_000,
    { stdin: JSON.stringify({ operation, operationId, digest, steps }), outputLimitBytes: 1_048_576 },
  )
  if (result.code !== 0) throw new ServerError('job_recovering', { detail: result.stderr.slice(-500), operation })
  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch (cause) {
    throw new ServerError('recipe_protocol', {}, { cause })
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('state' in value) ||
    !['not-started', 'running', 'completed', 'failed', 'unknown'].includes(String(value.state)) ||
    !('steps' in value) ||
    !Array.isArray(value.steps)
  )
    throw new ServerError('recipe_protocol')
  for (const step of value.steps)
    if (
      !step ||
      typeof step !== 'object' ||
      !Number.isInteger(step.ordinal) ||
      typeof step.software !== 'string' ||
      typeof step.state !== 'string' ||
      !Array.isArray(step.changes)
    )
      throw new ServerError('recipe_protocol')
  return value as RemoteResult
}
