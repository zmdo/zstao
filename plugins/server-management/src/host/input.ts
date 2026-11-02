import type { ErrorCode } from '../shared/errors.ts'
import { HttpError } from './errors.ts'

export function field(body: unknown, name: string): unknown {
  if (body === null || typeof body !== 'object') return undefined
  return (body as Record<string, unknown>)[name]
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'upgrade_invalid')
  return value as Record<string, unknown>
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function required(value: string, code: ErrorCode): string {
  if (value === '') throw new HttpError(422, code)
  return value
}
