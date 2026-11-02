import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ScriptDefinition } from '../../shared/contracts/definitions.ts'
import { ServerError } from '../../shared/errors.ts'

export interface LoadedScript {
  interpreter: ScriptDefinition['interpreter']
  timeoutMs: number
  outputLimitBytes: number
  body: string
}

export async function loadScript(script: ScriptDefinition): Promise<LoadedScript> {
  if (
    !isAbsolute(script.path) ||
    script.timeoutMs < 100 ||
    script.timeoutMs > 3_600_000 ||
    script.outputLimitBytes < 256 ||
    script.outputLimitBytes > 1_048_576
  )
    throw new ServerError('component_script_path')
  const body = await readFile(script.path, 'utf8')
  if (Buffer.byteLength(body) > 1_048_576 || body.includes('\0'))
    throw new ServerError('component_script_path')
  return Object.freeze({
    interpreter: script.interpreter,
    timeoutMs: script.timeoutMs,
    outputLimitBytes: script.outputLimitBytes,
    body,
  })
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function scriptCommand(script: LoadedScript): string {
  return script.interpreter === 'posix-sh'
    ? `sh -c ${quote(script.body)}`
    : `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script.body, 'utf16le').toString('base64')}`
}
