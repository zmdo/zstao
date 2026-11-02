import { menuDraft, type MenuLayout } from './menu.ts'

export interface MenuStore {
  get(): MenuLayout
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  apply(layout: MenuLayout): void
}

/** Saved groups. An empty layout means the sidebar still uses the overview default. */
export function createMenuStore(): MenuStore {
  let snap: MenuLayout = { groups: [], items: [] }
  const listeners = new Set<() => void>()
  const publish = (next: MenuLayout): void => {
    snap = next
    for (const listener of listeners) listener()
  }
  return {
    get: () => snap,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async refresh() {
      const response = await fetch('/console-api/menu', { credentials: 'same-origin' })
      if (!response.ok) return
      const draft = menuDraft(await response.json() as unknown)
      if (!draft.ok) return
      publish(draft.layout)
    },
    apply(layout) {
      publish(layout)
    },
  }
}
