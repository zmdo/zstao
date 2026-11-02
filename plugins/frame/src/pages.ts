export interface RegisteredPage {
  options: {
    key?: string
    label?: string | PageLabel
    order?: number
  }
}

/** Where a group sits. Footer groups stay at the bottom of the sidebar. */
export type PagePlacement = 'nav' | 'footer'
export type PageNavigation = 'tabs' | 'sidebar'

/**
 * Tab text plus the sidebar group. The slot ledger keeps `label` and drops
 * other register fields, so the group rides on this function.
 */
export interface PageLabel {
  (): string
  group?: string
  groupLabel?: string | (() => string)
  placement?: PagePlacement
  navigation?: PageNavigation
  icon?: string
}

export interface PageRoute {
  key: string
  label: string
  order: number
  group: string
  groupLabel: string
  placement: PagePlacement
  navigation?: PageNavigation
  icon: string
}

export interface NavGroup {
  id: string
  label: string
  placement: PagePlacement
  navigation?: PageNavigation
  order: number
  icon: string
  pages: PageRoute[]
}

/** Groups use page tabs unless they explicitly request sidebar children. */
export function pageLabel(text: string | (() => string), place?: { group: string; groupLabel: string | (() => string); placement?: PagePlacement; navigation?: PageNavigation; icon?: string }): PageLabel {
  const label: PageLabel = () => typeof text === 'function' ? text() : text
  if (place !== undefined) {
    label.group = place.group
    label.groupLabel = place.groupLabel
    if (place.placement !== undefined) label.placement = place.placement
    if (place.navigation !== undefined) label.navigation = place.navigation
    if (place.icon !== undefined && place.icon !== '') label.icon = place.icon
  }
  return label
}

function placementOf(label: string | PageLabel): PagePlacement | undefined {
  if (typeof label !== 'function') return undefined
  return label.placement === 'footer' ? 'footer' : label.placement === 'nav' ? 'nav' : undefined
}

function groupText(raw: string | PageLabel, fallback: string): string {
  if (typeof raw !== 'function') return fallback
  const value = raw.groupLabel
  if (typeof value === 'function') {
    const text = value()
    return text === '' ? fallback : text
  }
  if (value !== undefined && value !== '') return value
  return fallback
}

/** Sidebar groups and their tabs, in registration order. A page without a group is its own item. */
export function pageRoutes(entries: readonly RegisteredPage[]): PageRoute[] {
  const routes: PageRoute[] = []
  for (const entry of entries) {
    const key = entry.options.key
    const raw = entry.options.label
    if (key === undefined || raw === undefined) continue
    const label = typeof raw === 'function' ? raw() : raw
    if (label === '') continue
    const group = typeof raw === 'function' && raw.group !== undefined && raw.group !== '' ? raw.group : key
    const groupLabel = groupText(raw, label)
    routes.push({
      key,
      label,
      order: entry.options.order ?? 0,
      group,
      groupLabel,
      placement: placementOf(raw) ?? 'nav',
      navigation: typeof raw === 'function' && raw.navigation === 'sidebar' ? 'sidebar' : 'tabs',
      icon: typeof raw === 'function' && raw.icon !== undefined ? raw.icon : '',
    })
  }
  routes.sort((left, right) => left.order - right.order || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
  return routes
}

/** Drop pages a workspace group is not allowed to show. The route value used for filters stays unchanged. */
export function withoutPages(routes: readonly PageRoute[], hidden: readonly string[]): PageRoute[] {
  if (hidden.length === 0) return [...routes]
  const skip = new Set(hidden)
  return routes.filter(route => !skip.has(route.key))
}

/** Split routes into the scrolling nav and the footer. One footer page keeps the whole group at the bottom. */
export function navGroups(routes: readonly PageRoute[]): { nav: NavGroup[]; footer: NavGroup[] } {
  const byId = new Map<string, NavGroup>()
  for (const route of routes) {
    const existing = byId.get(route.group)
    if (existing === undefined) {
      byId.set(route.group, {
        id: route.group,
        label: route.groupLabel,
        placement: route.placement,
        navigation: route.navigation ?? 'tabs',
        order: route.order,
        icon: route.icon,
        pages: [route],
      })
      continue
    }
    existing.pages.push(route)
    if (route.order < existing.order) {
      existing.order = route.order
      existing.label = route.groupLabel
      existing.icon = route.icon
    }
    if (route.placement === 'footer') existing.placement = 'footer'
    if (route.navigation === 'sidebar') existing.navigation = 'sidebar'
  }
  const nav: NavGroup[] = []
  const footer: NavGroup[] = []
  for (const group of byId.values()) {
    group.pages.sort((left, right) => left.order - right.order || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    if (group.placement === 'footer') footer.push(group)
    else nav.push(group)
  }
  const byOrder = (left: NavGroup, right: NavGroup): number => left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  nav.sort(byOrder)
  footer.sort(byOrder)
  return { nav, footer }
}

/** Harness tabs. They stay on that row and out of the menu list. */
const NESTED_NAV = new Set(['agent'])

export function visibleGroups(groups: { nav: NavGroup[]; footer: NavGroup[] }): { nav: NavGroup[]; footer: NavGroup[] } {
  return {
    nav: groups.nav.filter(group => !NESTED_NAV.has(group.id)),
    footer: groups.footer,
  }
}
