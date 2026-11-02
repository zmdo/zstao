import { useCallback, useEffect, useState } from 'react'
import type { ServerDto } from '../../../shared/dto/servers.ts'
import type { ServerError } from '../../../shared/errors.ts'
import { api, requestError } from '../../shared/api.ts'

interface ResourceState {
  id: string
  server?: ServerDto
  error: ServerError | null
}

/**
 * Owns the base server resource for one workspace. The next request is scheduled
 * only after the previous one settles, so a slow response cannot overlap a newer
 * one. Changing the id hides the previous server before the new request starts.
 */
export function useServerResource(id: string, interval = 1000) {
  const [state, setState] = useState<ResourceState>({ id, error: null })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (id === '') {
      setState({ id, error: null })
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    // Keep the current data on an explicit refresh, but never keep another server's data.
    setState((current) => (current.id === id ? { ...current, error: null } : { id, error: null }))
    async function load() {
      try {
        const server = await api<ServerDto>(`/console-api/servers/${id}`, { signal: controller.signal })
        if (!stopped) setState({ id, server, error: null })
      } catch (cause) {
        if (!stopped)
          setState((current) => (current.id === id ? { ...current, error: requestError(cause) } : current))
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void load()
          }, interval)
      }
    }
    void load()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [id, interval, revision])

  const refresh = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  return {
    server: state.id === id ? state.server : undefined,
    error: state.id === id ? state.error : null,
    refresh,
  }
}
