export interface SectionStore {
  get(): string
  set(next: string): void
  subscribe(listener: () => void): () => void
}

/** The selected page key. Created inside apply, so a reload does not keep the previous one. */
export function createSection(initial = 'settings'): SectionStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(next) {
      if (current === next) return
      current = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
