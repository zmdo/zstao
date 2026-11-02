import type {
  Candidate,
  RecipeRequest,
  RecipeResponse,
  SoftwareObservation,
} from '../../shared/contracts/recipes.ts'
import { ServerError } from '../../shared/errors.ts'
import { type SshSession } from '../remote/ssh.ts'
import { scriptCommand, type LoadedScript } from './script.ts'

export async function invokeRecipe(
  session: SshSession,
  script: LoadedScript,
  request: RecipeRequest,
): Promise<RecipeResponse> {
  const response = await session.exec(scriptCommand(script), script.timeoutMs, {
    stdin: JSON.stringify(request),
    outputLimitBytes: script.outputLimitBytes,
  })
  if (response.code !== 0) throw new ServerError('recipe_protocol', { detail: response.stderr.slice(-500) })
  return parseRecipeResponse(response.stdout, request.operation)
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096

function packages(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(
      (p) =>
        record(p) &&
        ['manager', 'name', 'version', 'architecture', 'source'].every((k) => text(p[k])) &&
        (p.checksum === undefined || text(p.checksum)),
    )
  )
}

export function validObservation(value: unknown): value is SoftwareObservation {
  if (!record(value)) return false
  switch (value.state) {
    case 'missing':
      return true
    case 'unknown':
      return text(value.code)
    case 'installed':
      return (
        text(value.version) &&
        text(value.targetIdentity) &&
        packages(value.packages) &&
        typeof value.healthy === 'boolean'
      )
    default:
      return false
  }
}

export function validCandidate(value: unknown): value is Candidate {
  return (
    record(value) &&
    text(value.version) &&
    text(value.targetIdentity) &&
    packages(value.packages) &&
    (value.channel === 'stable' || value.channel === 'prerelease')
  )
}

/** Process output is untrusted even when the script was contributed by a trusted plugin. */
export function parseRecipeResponse(raw: string, operation: RecipeRequest['operation']): RecipeResponse {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new ServerError('recipe_protocol', {}, { cause })
  }
  if (!record(value) || value.operation !== operation) throw new ServerError('recipe_protocol')
  let valid = false
  switch (operation) {
    case 'detect':
      valid = validObservation(value.result)
      break
    case 'list-candidates':
      valid =
        Array.isArray(value.candidates) &&
        value.candidates.length <= 1024 &&
        value.candidates.every(validCandidate)
      break
    case 'resolve': {
      const change = value.change
      valid =
        record(change) &&
        ['software', 'recipe', 'recipeRevision'].every((k) => text(change[k])) &&
        ['keep', 'defer-install', 'install', 'upgrade', 'replace'].includes(String(change.action)) &&
        validObservation(change.before) &&
        (change.target === undefined || validCandidate(change.target)) &&
        Array.isArray(change.dependencies) &&
        change.dependencies.every(text) &&
        Array.isArray(change.effects) &&
        change.effects.every(
          (e) =>
            record(e) &&
            ['service-restart', 'service-stop', 'configuration', 'other'].includes(String(e.kind)) &&
            record(e.description) &&
            text(e.description.zh) &&
            text(e.description.en),
        ) &&
        Object.hasOwn(change, 'payload') &&
        Array.isArray(value.additionalRequirements) &&
        value.additionalRequirements.length === 0
      break
    }
    case 'execute':
      valid = ['completed', 'failed'].includes(String(value.state)) && Array.isArray(value.changes)
      break
    case 'verify':
      valid = validObservation(value.result) && typeof value.healthy === 'boolean'
      break
    case 'recover':
      valid =
        ['not-started', 'running', 'completed', 'failed', 'unknown'].includes(String(value.state)) &&
        Array.isArray(value.changes)
      break
  }
  if (!valid) throw new ServerError('recipe_protocol')
  return value as unknown as RecipeResponse
}
