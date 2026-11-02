import { ServerError, parseError as responseError } from '../../shared/errors.ts'
export { parseError as responseError } from '../../shared/errors.ts'
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers:
      init?.body === undefined ? init?.headers : { 'content-type': 'application/json', ...init.headers },
  })
  if (response.status === 204) return undefined as T
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) throw responseError(payload)
  return payload as T
}

export function requestError(cause: unknown): ServerError {
  if (cause instanceof ServerError) return cause
  return new ServerError('request_failed', cause instanceof Error ? { detail: cause.message } : {}, { cause })
}
