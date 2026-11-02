import type { Context } from '@deepseek-ai/cordis'

interface EffectMeta {
  label?: string
}

/**
 * The agent loop's own per-session effect. Disposing it cancels the driver,
 * closes the log handle, and removes the session from the in-memory store.
 * The label is matched by shape so a second copy of Cordis does not hide it.
 */
export async function releaseLiveSession(root: Context, sessionId: string): Promise<boolean> {
  const label = `agentLoop.scope(${sessionId})`
  for (const runtime of root.registry.values()) {
    for (const fiber of runtime.fibers) {
      for (const dispose of fiber._disposables) {
        if (effectLabel(dispose) !== label) continue
        await dispose()
        return true
      }
    }
  }
  return false
}

function effectLabel(dispose: object): string | undefined {
  for (const key of Object.getOwnPropertySymbols(dispose)) {
    const value = (dispose as Record<symbol, EffectMeta>)[key]
    if (value !== null && typeof value === 'object' && typeof value.label === 'string') return value.label
  }
  return undefined
}
