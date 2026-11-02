import { useEffect, useState } from 'react'
import type { ServerError } from '../../shared/errors.ts'
import { api, requestError } from './api.ts'

/** Each mounted view owns and aborts its current request and the next polling timer. */
export function usePollingResource<T>(path: string, interval = 3000) {
  const [loaded, setLoaded] = useState<{ path: string; data: T }>()
  const [error, setError] = useState<ServerError | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setError(null)
    async function load() {
      try {
        const data = await api<T>(path, { signal: controller.signal })
        if (!stopped) {
          setLoaded({ path, data })
          setError(null)
        }
      } catch (cause) {
        if (!stopped) setError(requestError(cause))
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
  }, [path, interval])
  return { data: loaded?.path === path ? loaded.data : undefined, error }
}
