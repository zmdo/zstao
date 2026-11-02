import type { Db } from '../database/connection.ts'
import { ServerError } from '../../shared/errors.ts'
import type { ExecLimits } from './exec.ts'
import { readSettings, writeSettings } from './persistence/settings-repository.ts'

const HARD_MAX = {
  timeoutMs: 120_000,
  commandBytes: 64 * 1024,
  outputBytes: 1024 * 1024,
} as const

export interface ExecLimitsView extends ExecLimits {
  updated_at: string | null
}

export async function loadExecLimits(db: Db, fallback: ExecLimits): Promise<ExecLimitsView> {
  const row = (await readSettings(db)).rows[0]
  if (row === undefined) return { ...fallback, updated_at: null }
  return {
    defaultTimeoutMs: row.default_timeout_ms,
    maxTimeoutMs: row.max_timeout_ms,
    defaultCommandBytes: row.default_command_bytes,
    maxCommandBytes: row.max_command_bytes,
    defaultOutputBytes: row.default_output_bytes,
    maxOutputBytes: row.max_output_bytes,
    rsyncDeniedFlags: row.rsync_denied_flags,
    updated_at: row.updated_at.toISOString(),
  }
}

export function validateExecLimits(input: unknown): ExecLimits {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalid()
  const value = input as Record<string, unknown>
  const limits: ExecLimits = {
    defaultTimeoutMs: integer(value.defaultTimeoutMs, 'defaultTimeoutMs'),
    maxTimeoutMs: integer(value.maxTimeoutMs, 'maxTimeoutMs'),
    defaultCommandBytes: integer(value.defaultCommandBytes, 'defaultCommandBytes'),
    maxCommandBytes: integer(value.maxCommandBytes, 'maxCommandBytes'),
    defaultOutputBytes: integer(value.defaultOutputBytes, 'defaultOutputBytes'),
    maxOutputBytes: integer(value.maxOutputBytes, 'maxOutputBytes'),
    rsyncDeniedFlags: strings(value.rsyncDeniedFlags, 'rsyncDeniedFlags'),
  }
  if (limits.maxTimeoutMs > HARD_MAX.timeoutMs || limits.maxCommandBytes > HARD_MAX.commandBytes || limits.maxOutputBytes > HARD_MAX.outputBytes)
    throw invalid()
  if (limits.defaultTimeoutMs > limits.maxTimeoutMs || limits.defaultCommandBytes > limits.maxCommandBytes || limits.defaultOutputBytes > limits.maxOutputBytes)
    throw invalid()
  return limits
}

export async function saveExecLimits(db: Db, input: unknown, updatedBy: string): Promise<ExecLimitsView> {
  const limits = validateExecLimits(input)
  const row = (await writeSettings(db, limits, updatedBy)).rows[0]
  return { ...limits, updated_at: row?.updated_at.toISOString() ?? null }
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '' || item.trim() !== item || item.length > 128))
    throw invalid(field)
  return [...new Set(value)]
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw invalid(field)
  return value
}

function invalid(field?: string): ServerError {
  return new ServerError('invalid_request', { detail: field === undefined ? 'invalid execution limits' : `invalid execution limit: ${field}` })
}

export { HARD_MAX }
