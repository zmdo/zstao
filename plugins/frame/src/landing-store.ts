import { DEFAULT_LANDING, DEFAULT_SIDEBAR, sidebarMode, type SidebarMode } from './landing.ts'

export interface LandingSnap {
  page: string
  sidebar: SidebarMode
  loaded: boolean
}

export interface LandingStore {
  get(): LandingSnap
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  apply(page: string): void
  applySidebar(mode: SidebarMode): void
}

/** The page and sidebar chosen for the next visit. Both stay at their defaults until a save. */
export function createLandingStore(): LandingStore {
  let snap: LandingSnap = { page: DEFAULT_LANDING, sidebar: DEFAULT_SIDEBAR, loaded: false }
  const listeners = new Set<() => void>()
  const publish = (next: LandingSnap): void => {
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
      const next: LandingSnap = { ...snap, loaded: true }
      try {
        const response = await fetch('/console-api/landing', { credentials: 'same-origin' })
        if (response.ok) {
          const body = await response.json() as { page?: unknown; sidebar?: unknown }
          if (typeof body.page === 'string' && body.page !== '') next.page = body.page
          next.sidebar = sidebarMode(body.sidebar)
        }
      } catch (cause) {
        void cause
      }
      publish(next)
    },
    apply(page) {
      publish({ ...snap, page })
    },
    applySidebar(mode) {
      publish({ ...snap, sidebar: mode })
    },
  }
}
