import type { Deps } from '../dependencies.ts'
import type { connectSsh } from '../remote/ssh.ts'
import type { ExecContext, ApprovalRequester } from '../harness/exec.ts'
import type { Authorization } from '../harness/authorization.ts'
export type AdminDeps = Deps & { connect?: typeof connectSsh }
export type AdminContext = ExecContext & {
  approval?: ApprovalRequester
  source?: 'web' | 'system'
  approvalId?: string
  approvedAt?: Date
  authorization?: Authorization
}
export type Input = Record<string, unknown>
export class AdminError extends Error {
  readonly code: string
  constructor(code: string, details?: Record<string, unknown>) {
    super(JSON.stringify({ code, ...details }))
    this.name = 'AdminError'
    this.code = code
  }
}
export function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AdminError('invalid_request')
  return value as Input
}
export function fields(value: Input, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new AdminError('invalid_request')
}
export function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AdminError('invalid_request')
  return value.trim()
}
export function uuid(value: unknown): string {
  const id = text(value)
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new AdminError('invalid_request')
  return id
}
export function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))
    throw new AdminError('server_revision_conflict')
  return value
}

export function instant(value: unknown, code = 'invalid_request'): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    throw new AdminError(code)
  const date = new Date(value)
  if (!Number.isFinite(+date)) throw new AdminError(code)
  return date
}
