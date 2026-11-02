import { DEFAULT_TITLE } from './site.ts'
import { DEFAULT_ICON_DARK, DEFAULT_ICON_LIGHT } from './site-mark.ts'

export interface SiteSnap {
  title: string
  icon: string
}

export interface SiteStore {
  get(): SiteSnap
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  apply(title: string, icon: string): void
}

/** The layout plugin writes this product name. It is not the saved site title. */
const HARNESS_TITLE = 'DeepSeek Harness'

/**
 * Harness writes either its product name or `session — DeepSeek Harness`.
 * Keep the session prefix and swap in the saved site name.
 */
export function nextDocumentTitle(current: string, product: string, previous: string): string {
  const names = [...new Set([previous, DEFAULT_TITLE, HARNESS_TITLE].filter(name => name !== ''))]
  for (const name of names) {
    if (current === name) return product
    const mark = ` — ${name}`
    if (current.endsWith(mark)) return `${current.slice(0, -mark.length)} — ${product}`
  }
  return current
}

/** Browser tab title and favicon. An empty icon uses the control hub. */
export function applySiteChrome(title: string, icon: string, previous = title): void {
  const product = title.trim() === '' ? DEFAULT_TITLE : title
  const prior = previous.trim() === '' ? DEFAULT_TITLE : previous
  const next = nextDocumentTitle(document.title, product, prior)
  if (document.title !== next) document.title = next
  const links = [...document.head.querySelectorAll('link[rel="icon"]')]
  if (icon === '') {
    const hrefs = links.map(link => link.getAttribute('href') ?? '')
    if (hrefs.length === 2 && hrefs[0] === DEFAULT_ICON_LIGHT && hrefs[1] === DEFAULT_ICON_DARK) return
    for (const link of links) link.remove()
    document.head.append(defaultIcon('light', DEFAULT_ICON_LIGHT), defaultIcon('dark', DEFAULT_ICON_DARK))
    return
  }
  for (const link of links) link.remove()
  const custom = document.createElement('link')
  custom.rel = 'icon'
  custom.href = icon
  document.head.append(custom)
}

function defaultIcon(scheme: 'light' | 'dark', href: string): HTMLLinkElement {
  const link = document.createElement('link')
  link.rel = 'icon'
  link.type = 'image/svg+xml'
  link.href = href
  link.media = `(prefers-color-scheme: ${scheme})`
  return link
}

function siteSnap(body: { title?: unknown; icon?: unknown }): SiteSnap {
  return {
    title: typeof body.title === 'string' && body.title !== '' ? body.title : DEFAULT_TITLE,
    icon: typeof body.icon === 'string' ? body.icon : '',
  }
}

/** Follow harness when it rewrites the tab, and put the saved name back. */
function watchDocumentTitle(getProduct: () => string): () => void {
  if (typeof document === 'undefined') return () => {}
  const fix = (): void => {
    const product = getProduct()
    const next = nextDocumentTitle(document.title, product, product)
    if (next !== document.title) document.title = next
  }
  const title = document.head.querySelector('title') ?? document.head.appendChild(document.createElement('title'))
  const observer = new MutationObserver(fix)
  observer.observe(title, { childList: true, characterData: true, subtree: true })
  return () => { observer.disconnect() }
}

/** One record for the tab, the sidebar, and the login page. */
export function createSiteStore(): SiteStore {
  let snap: SiteSnap = { title: DEFAULT_TITLE, icon: '' }
  let product = DEFAULT_TITLE
  const listeners = new Set<() => void>()
  watchDocumentTitle(() => product)
  const publish = (next: SiteSnap): void => {
    const prior = product
    const title = next.title.trim() === '' ? DEFAULT_TITLE : next.title
    product = title
    snap = { title, icon: next.icon }
    applySiteChrome(title, next.icon, prior)
    for (const listener of listeners) listener()
  }
  return {
    get: () => snap,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async refresh() {
      const response = await fetch('/console-api/site', { credentials: 'same-origin' })
      if (!response.ok) return
      publish(siteSnap(await response.json() as { title?: unknown; icon?: unknown }))
    },
    apply(title, icon) {
      publish({ title: title.trim() === '' ? DEFAULT_TITLE : title, icon })
    },
  }
}
