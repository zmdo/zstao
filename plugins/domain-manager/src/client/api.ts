export interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: init?.body === undefined ? init?.headers : { 'content-type': 'application/json', ...init.headers },
  })
  if (response.status === 204) return undefined as T
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const body = payload as { code?: unknown; detail?: unknown }
    throw new ApiError(typeof body.code === 'string' ? body.code : 'request_failed', typeof body.detail === 'string' ? body.detail : '')
  }
  return payload as T
}
