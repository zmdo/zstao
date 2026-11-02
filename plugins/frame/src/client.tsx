import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { consoleCss } from '@smp/console-kit'
import { navGroups, pageLabel, pageRoutes, visibleGroups, withoutPages, type NavGroup, type RegisteredPage } from './pages.ts'
import { createSection, type SectionStore } from './section.ts'
import { shellCopy, type ShellCopy } from './copy.ts'
import { GeneralView, type LocaleFace, type ThemeFace } from './general-view.tsx'
import { SecurityView } from './security-view.tsx'
import { DEFAULT_ICON_DARK, DEFAULT_ICON_LIGHT } from './site-mark.ts'
import { createSiteStore, type SiteStore } from './site-chrome.ts'
import { CONVERSATION_ID, menuChoices, sidebarBlocks, type PlacedOption } from './menu.ts'
import { createMenuStore, type MenuStore } from './menu-store.ts'
import { DEFAULT_LANDING, DEFAULT_SIDEBAR } from './landing.ts'
import { createLandingStore, type LandingStore } from './landing-store.ts'
import { MenuView } from './menu-view.tsx'
import { RailChoice } from './rail-choice.tsx'
import sidebarFlyoutCss from './sidebar-flyout.css'

interface Layout {
  selectPanel(id: string | null): void
  toggleSidebar(): void
}

interface AuthSnap {
  checked: boolean
  authenticated: boolean
  username: string | null
  passwordIsDefault: boolean
  totpEnabled: boolean
}

interface AuthStore {
  get(): AuthSnap
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  logout(): Promise<void>
}

interface GroupFace {
  subscribe(listener: () => void): () => void
  hiddenPages(): string[]
  renderSidebar(renderSlot: RenderSlot): ReactNode
}

interface ShellCtx {
  slots: PageSlots
  layout: Layout
  locale: LocaleFace
  theme: ThemeFace
  workspaceGroups: GroupFace
  on(name: 'theme/change', listener: () => void): () => void
  effect(run: () => (() => void)): void
}

interface PageSlots {
  entries(key: string): readonly RegisteredPage[]
  subscribe(key: string, listener: () => void): () => void
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface RenderSlot {
  (name: string, props: object, options?: { entryKey?: string; fallback?: ReactNode }): ReactNode
}

interface ChatSideMount {
  subscribe(listener: () => void): () => void
  get(): HTMLElement | null
  set(node: HTMLElement | null): void
}

const SIDEBAR_MOTION_MS = 300
const CONSOLE_PANEL = 'console'
const SECURITY_PAGE = 'settings'
const GENERAL_PAGE = 'general'
const MENU_PAGE = 'menu'
const PLATFORM_GROUP = 'platform'
const AGENT_GROUP = 'agent'
const AGENT_CHAT = 'agent-chat'
const ARCHIVE_PAGE = 'archive'

const SHELL_STYLE = `
.smp-shell, .smp-console, .smp-sidebar-flyout {
  --smp-text: var(--dsw-alias-label-primary); --smp-muted: var(--dsw-alias-label-tertiary); --smp-line: var(--dsw-alias-border-l2);
  --smp-primary: var(--dsw-alias-state-business-primary); --smp-primary-soft: var(--dsw-specific-sidebar-nav-item-active);
  color: var(--smp-text);
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px; line-height: 1.5;
}
.smp-shell { height: 100%; display: flex; flex-direction: column; background: var(--dsw-specific-sidebar-fill); overflow: hidden; }
.smp-shell.is-collapsed { align-items: center; padding-top: 14px; }
.smp-shell .logo-name, .smp-shell .nav-item > span, .smp-shell .nav-title, .smp-shell .fold {
  transition: opacity var(--ds-transition-duration, .2s) var(--ds-ease-in-out, ease);
}
.smp-shell.is-closing .logo-name, .smp-shell.is-closing .nav-item > span, .smp-shell.is-closing .nav-title, .smp-shell.is-closing .fold { opacity: 0; }
html[data-smp-sidebar] div:has(> div > div > .smp-shell) {
  transition: grid-template-columns var(--ds-transition-duration-slow, .3s) var(--ds-ease-in-out, cubic-bezier(.4, 0, .2, 1));
}
html[data-smp-sidebar] div:has(> div > div > .smp-shell) > [class*="_handle"] {
  transition: left var(--ds-transition-duration-slow, .3s) var(--ds-ease-in-out, cubic-bezier(.4, 0, .2, 1));
}
html[data-smp-sidebar] div[data-dragging]:has(> div > div > .smp-shell),
html[data-smp-sidebar] div[data-dragging]:has(> div > div > .smp-shell) > [class*="_handle"],
html[data-smp-sidebar] div[data-rightbar-instant]:has(> div > div > .smp-shell),
html[data-smp-sidebar] div[data-rightbar-instant]:has(> div > div > .smp-shell) > [class*="_handle"] { transition: none; }
@media (prefers-reduced-motion: reduce) {
  html[data-smp-sidebar] div:has(> div > div > .smp-shell),
  html[data-smp-sidebar] div:has(> div > div > .smp-shell) > [class*="_handle"] { transition: none; }
  .smp-shell .logo-name, .smp-shell .nav-item > span, .smp-shell .nav-title, .smp-shell .fold { transition: none; }
}
.smp-shell .logo { height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 12px 0 16px; font-size: 15px; font-weight: 650; color: var(--smp-text); }
.smp-shell .logo-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.smp-shell .fold {
  width: 20px; height: 20px; margin-left: auto; border: 0; border-radius: 4px; background: transparent;
  color: var(--smp-muted); display: grid; place-items: center; padding: 0; flex: none; cursor: pointer;
}
.smp-shell .fold .nav-glyph, .smp-shell .rail-expand .nav-glyph { width: 20px; height: 20px; }
.smp-shell .fold:hover { color: var(--smp-primary); }
.smp-shell .nav-glyph { width: 18px; height: 18px; flex: none; display: block; }
.smp-shell .rail { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; width: 100%; min-height: 0; padding: 8px 0 12px; }
.smp-shell .rail-foot { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.smp-shell .rail-item {
  width: 40px; height: 40px; border: 0; border-radius: 6px; background: transparent; color: var(--smp-text);
  display: grid; place-items: center; padding: 0; cursor: pointer;
}
.smp-shell .rail-item.is-on { background: var(--smp-primary-soft); color: var(--smp-primary); }
.smp-shell .rail-item:hover { color: var(--smp-primary); }
.smp-shell .logo-mark, .smp-shell .rail-mark {
  width: 20px; height: 20px; border-radius: 6px; background: var(--smp-primary); color: #fff;
  display: grid; place-items: center; font-size: 14px; font-weight: 700; border: 0; padding: 0;
}
.smp-shell .logo-mark.has-icon, .smp-shell .rail-mark.has-icon { background: transparent; color: var(--smp-text); }
.smp-shell .rail-mark { cursor: pointer; }
.smp-shell .logo-mark img, .smp-shell .rail-mark img { width: 20px; height: 20px; display: block; object-fit: contain; }
.smp-shell .rail-expand { display: none; }
.smp-shell .rail-mark:hover, .smp-shell .rail-mark:focus-visible { color: var(--smp-primary); }
.smp-shell .rail-mark:hover .rail-logo, .smp-shell .rail-mark:focus-visible .rail-logo { display: none; }
.smp-shell .rail-mark:hover .rail-expand, .smp-shell .rail-mark:focus-visible .rail-expand { display: grid; }
.smp-shell .mark-dark { display: none; }
body[data-ds-dark-theme] .smp-shell .mark-light { display: none; }
body[data-ds-dark-theme] .smp-shell .mark-dark { display: block; }
.smp-shell .nav { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 8px 10px; gap: 2px; overflow: auto; }
.smp-shell .nav-title { margin: 16px 12px 4px; color: var(--smp-muted); font-size: 13px; font-weight: 600; }
.smp-shell .nav > .menu-block:first-child .nav-title, .smp-shell .nav-foot > .menu-block:first-child .nav-title { margin-top: 8px; }
.smp-console .site-icon-field { display: grid; gap: 6px; justify-items: start; color: var(--dsw-alias-label-secondary); }
.smp-console button.site-icon { width: 100px; height: 100px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; overflow: hidden; }
.smp-console button.site-icon img { width: 100px; height: 100px; object-fit: contain; display: block; }
.smp-console button.site-icon .mark-dark { display: none; }
body[data-ds-dark-theme] .smp-console button.site-icon .mark-light { display: none; }
body[data-ds-dark-theme] .smp-console button.site-icon .mark-dark { display: block; }
.smp-console .menu-board { display: grid; gap: 12px; }
.smp-console .menu-group { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 10px 12px; }
.smp-console .menu-group.is-over { border-color: var(--dsw-alias-state-business-primary); }
.smp-console .menu-group header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; font-weight: 600; }
.smp-console .menu-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
.smp-console .menu-group header .actions { display: flex; gap: 8px; flex: none; }
.smp-console .menu-rename { display: flex; align-items: center; gap: 6px; }
.smp-console .menu-rename input { width: 180px; font: inherit; font-weight: 600; }
.smp-console button.menu-mark { width: 28px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; display: grid; place-items: center; }
.smp-console button.menu-mark.ok { color: var(--green); }
.smp-console button.menu-mark.no { color: var(--red); }
.smp-console .menu-item { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; margin-bottom: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); cursor: grab; }
.smp-console .menu-grip { width: 10px; height: 14px; flex: none; cursor: grab; background: radial-gradient(circle, var(--dsw-alias-label-tertiary) 1px, transparent 1.5px) 0 0 / 5px 5px; }
.smp-console .menu-empty { margin: 0; color: var(--dsw-alias-label-tertiary); }
.smp-shell .nav-foot { margin-top: auto; padding: 8px 10px 12px; border-top: 1px solid var(--smp-line); }
.smp-shell .nav-item, .smp-shell .nav-sub-item {
  display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent;
  text-align: left; color: var(--smp-text); border-radius: 4px; position: relative;
}
.smp-shell .nav-item { height: 44px; padding: 0 12px; font-size: 14px; }
.smp-shell .nav-item:hover, .smp-shell .nav-sub-item:hover { color: var(--smp-primary); }
.smp-shell .nav-item.is-on { background: var(--smp-primary-soft); color: var(--smp-primary); font-weight: 600; }
.smp-shell .nav-item.is-on::before {
  content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--smp-primary);
}
.smp-shell .nav-group { display: flex; flex-direction: column; }
.smp-shell .nav-parent.is-active { color: var(--smp-primary); font-weight: 600; }
.smp-shell .nav-chevron {
  width: 6px; height: 6px; margin-left: auto; margin-right: 4px; flex: none;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg);
}
.smp-shell .nav-group.is-open .nav-chevron { transform: rotate(45deg); }
.smp-shell .nav-head { display: flex; align-items: center; }
.smp-shell .nav-head .nav-item { flex: 1; min-width: 0; }
.smp-shell .nav-caret {
  width: 28px; height: 28px; margin-right: 4px; border: 0; border-radius: 4px; background: transparent;
  color: var(--smp-muted); display: grid; place-items: center; padding: 0; cursor: pointer; flex: none;
}
.smp-shell .nav-caret::before {
  content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg); margin-left: -2px;
}
.smp-shell .nav-caret:hover { color: var(--smp-primary); }
.smp-shell .nav-group.is-open .nav-caret { transform: rotate(90deg); }
.smp-shell .nav-sub { display: flex; flex-direction: column; gap: 2px; padding: 0 0 4px 26px; }
.smp-shell .nav-sub-item { height: 34px; padding: 0 12px; font-size: 14px; }
.smp-shell .nav-sub-item.is-on { color: var(--smp-primary); font-weight: 600; background: var(--smp-primary-soft); }
[data-phase]:has(.smp-chat-side) { padding-left: 280px; padding-top: 49px; }
.smp-chat-bar { position: absolute; top: 0; left: 0; right: 0; z-index: 6; }
.smp-chat-side {
  position: absolute; left: 0; top: 49px; bottom: 0; width: 280px; z-index: 4; box-sizing: border-box;
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  --dsh-sidebar-inline-padding: 12px; padding: 6px 0 8px 4px;
  border-right: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-sidebar-fill);
  color: var(--dsw-alias-label-primary);
}
.smp-chat-side > * { flex: 1; min-height: 0; min-width: 0; }
.smp-console {
  --text: var(--smp-text); --muted: var(--smp-muted); --line: var(--smp-line); --border: var(--dsw-alias-border-l3);
  --primary: var(--smp-primary); --primary-soft: var(--dsw-alias-state-business-tertiary);
  --green: var(--dsw-alias-state-success-primary); --green-bg: var(--dsw-alias-state-success-tertiary);
  --red: var(--dsw-alias-state-error-primary); --red-bg: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent);
  --warn: var(--dsw-alias-state-warn-label); --warn-bg: var(--dsw-alias-state-warn-tertiary); --bg: var(--dsw-alias-bg-base);
  height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--bg);
}
.smp-console .topbar, .smp-chat-bar {
  height: 48px; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l2);
  display: flex; align-items: center; justify-content: space-between; padding: 0 8px 0 20px; flex: none;
}
.smp-console .tabs, .smp-chat-bar .tabs { display: flex; height: 100%; gap: 4px; }
.smp-console .tab, .smp-chat-bar .tab {
  display: flex; align-items: center; height: 100%; padding: 0 14px; border: 0; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.smp-console .tab.is-on, .smp-chat-bar .tab.is-on { color: var(--dsw-alias-state-business-primary); box-shadow: inset 0 -2px 0 var(--dsw-alias-state-business-primary); }
.smp-console .content { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px 28px; }
`

function createAuth(): AuthStore {
  let snap: AuthSnap = {
    checked: false,
    authenticated: false,
    username: null,
    passwordIsDefault: false,
    totpEnabled: false,
  }
  const listeners = new Set<() => void>()
  const publish = (next: AuthSnap): void => {
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
      try {
        const response = await fetch('/console-api/auth/me', { credentials: 'include' })
        const me = await response.json() as {
          authenticated?: boolean
          username?: string | null
          password_is_default?: boolean
          totp_enabled?: boolean
        }
        publish({
          checked: true,
          authenticated: me.authenticated === true,
          username: typeof me.username === 'string' ? me.username : null,
          passwordIsDefault: me.password_is_default === true,
          totpEnabled: me.totp_enabled === true,
        })
      } catch (error) {
        // A failed status check leaves the page logged out.
        void error
        publish({ checked: true, authenticated: false, username: null, passwordIsDefault: false, totpEnabled: false })
      }
    },
    async logout() {
      await fetch('/console-api/auth/logout', { method: 'POST', credentials: 'include' })
      publish({ checked: true, authenticated: false, username: null, passwordIsDefault: false, totpEnabled: false })
    },
  }
}

function useCopy(locale: LocaleFace): ShellCopy {
  const snap = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot())
  return shellCopy(snap.active)
}

function createChatSideMount(): ChatSideMount {
  const node = document.createElement('aside')
  node.className = 'smp-chat-side'
  return {
    subscribe: () => () => {},
    get: () => node,
    // The root owns this node; session-scoped headers only offer its current attachment point.
    set(host) { if (host !== null && node.parentElement !== host) host.append(node) },
  }
}

function OfficialSessions(props: { mount: ChatSideMount; groups: GroupFace; renderSlot?: RenderSlot }) {
  const node = useSyncExternalStore(props.mount.subscribe, props.mount.get)
  if (node === null || props.renderSlot === undefined) return null
  return createPortal(props.groups.renderSidebar(props.renderSlot), node)
}

function usePages(slots: PageSlots, locale: LocaleFace): ReturnType<typeof pageRoutes> {
  const entries = useSyncExternalStore(
    listener => slots.subscribe('console.page', listener),
    () => slots.entries('console.page'),
  )
  useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot())
  return pageRoutes(entries)
}

function groupOf(pages: ReturnType<typeof pageRoutes>, key: string): NavGroup | undefined {
  const groups = navGroups(pages)
  return groups.nav.concat(groups.footer).find(group => group.pages.some(page => page.key === key))
}

function NavGlyph(props: { name: string }) {
  const common = { className: 'nav-glyph', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }
  if (props.name === 'chat') {
    return (
      <svg {...common}>
        <path d="M3.1 3.2h9.8c.7 0 1.2.5 1.2 1.2v5.1c0 .7-.5 1.2-1.2 1.2H7.1L4.2 13.1v-2.4H3.1c-.7 0-1.2-.5-1.2-1.2V4.4c0-.7.5-1.2 1.2-1.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    )
  }
  if (props.name === 'settings') {
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    )
  }
  if (props.name === 'server') {
    return (
      <svg {...common}>
        <rect x="2.2" y="2.2" width="11.6" height="4.2" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
        <rect x="2.2" y="9.4" width="11.6" height="4.2" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.3" cy="4.3" r="0.6" fill="currentColor" />
        <circle cx="4.3" cy="11.5" r="0.6" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="3" y="3" width="10" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function FoldIcon() {
  return (
    <svg className="nav-glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.4" y="3" width="11.2" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 3v10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
function BrandMark(props: { icon: string }) {
  if (props.icon !== '') return <img src={props.icon} alt="" />
  return (
    <>
      <img className="mark-light" src={DEFAULT_ICON_LIGHT} alt="" />
      <img className="mark-dark" src={DEFAULT_ICON_DARK} alt="" />
    </>
  )
}

/** Keep the wide column until the width transition ends, then show the rail. */
function useRail(collapsed: boolean): boolean {
  const [rail, setRail] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) {
      setRail(false)
      return
    }
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.dataset.smpSidebar !== '1'
    if (instant) {
      setRail(true)
      return
    }
    const id = window.setTimeout(() => { setRail(true) }, SIDEBAR_MOTION_MS)
    return () => { window.clearTimeout(id) }
  }, [collapsed])
  return rail
}

function ShellSidebar(props: {
  slots: PageSlots
  locale: LocaleFace
  section: SectionStore
  site: SiteStore
  menu: MenuStore
  landing: LandingStore
  chatSide: ChatSideMount
  groups: GroupFace
  collapsed: boolean
  width: number
  openConsole: (id: string) => void
  toggleSidebar: () => void
  renderSlot?: RenderSlot
  usePanelInfo?: (select: (info: { activePanelId: string | null }) => string | null) => string | null
}) {
  const current = useSyncExternalStore(props.section.subscribe, props.section.get)
  const hidden = useSyncExternalStore(props.groups.subscribe, props.groups.hiddenPages)
  const pages = withoutPages(usePages(props.slots, props.locale), hidden)
  const copy = useCopy(props.locale)
  const site = useSyncExternalStore(props.site.subscribe, props.site.get)
  const saved = useSyncExternalStore(props.menu.subscribe, props.menu.get)
  const chrome = useSyncExternalStore(props.landing.subscribe, props.landing.get)
  const seenSidebar = useRef<string | null>(null)
  const wide = useRef(props.width >= 200 ? props.width : 280)
  if (!props.collapsed && props.width >= 200) wide.current = props.width
  const rail = useRail(props.collapsed)
  const [flyout, setFlyout] = useState<string | null>(null)
  const pageKeys = pages.map(page => page.key).join('\0')
  useEffect(() => { setFlyout(null) }, [rail, current, pageKeys])
  useEffect(() => {
    const mode = chrome.loaded ? chrome.sidebar : DEFAULT_SIDEBAR
    if (seenSidebar.current === mode) return
    seenSidebar.current = mode
    if ((mode === 'collapsed') !== props.collapsed) props.toggleSidebar()
  }, [chrome.loaded, chrome.sidebar, props.collapsed, props.toggleSidebar])
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        document.documentElement.dataset.smpSidebar = '1'
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])
  const groups = navGroups(pages)
  const listed = visibleGroups(groups)
  const byId = new Map(listed.nav.concat(listed.footer).map(group => [group.id, group]))
  const blocks = sidebarBlocks(menuChoices(listed, copy.harness), saved, copy.overview)
  const panelId = props.usePanelInfo?.(info => info.activePanelId)
  const onConversation = panelId === null
  const harnessOn = current === AGENT_CHAT || current === ARCHIVE_PAGE
  useEffect(() => {
    if (pages.length === 0 || pages.some(page => page.key === current)) return
    if (current === props.landing.get().page) return
    const fallback = pages.find(page => page.key === DEFAULT_LANDING) ?? pages[0]
    if (fallback !== undefined) props.section.set(fallback.key)
  }, [pages, current, props.section, props.landing])

  const openItem = (id: string): void => {
    if (id === CONVERSATION_ID) {
      props.openConsole(AGENT_CHAT)
      if (!props.collapsed) props.toggleSidebar()
      return
    }
    const group = byId.get(id)
    const page = group?.navigation === 'sidebar'
      ? group.pages.find(page => page.key === current) ?? group.pages[0]
      : group?.pages[0]
    if (page !== undefined) props.openConsole(page.key)
    if (group?.navigation === 'sidebar' && props.collapsed) props.toggleSidebar()
  }
  const itemOn = (item: PlacedOption): boolean => {
    if (item.id === CONVERSATION_ID) return harnessOn
    return !onConversation && (byId.get(item.id)?.pages.some(page => page.key === current) ?? false)
  }
  const railChoice = (item: PlacedOption): ReactNode => {
    const group = item.id === CONVERSATION_ID
      ? groups.nav.find(group => group.id === AGENT_GROUP)
      : byId.get(item.id)
    const hasChildren = group !== undefined && (
      group.pages.length > 1 || group.navigation === 'sidebar' || group.id !== group.pages[0]?.key
    )
    return (
      <RailChoice
        key={item.id}
        label={item.label}
        icon={<NavGlyph name={item.icon === '' ? 'box' : item.icon} />}
        active={itemOn(item)}
        pages={hasChildren ? group.pages : []}
        current={onConversation ? AGENT_CHAT : current}
        expanded={flyout === item.id}
        onShow={() => setFlyout(item.id)}
        onHide={() => setFlyout(value => value === item.id ? null : value)}
        onOpen={() => openItem(item.id)}
        onSelect={props.openConsole}
      />
    )
  }

  const column = rail ? (
      <div className="smp-shell is-collapsed">
        <button className="rail-mark has-icon" type="button" aria-label={copy.expand} onClick={props.toggleSidebar}>
          <span className="rail-logo"><BrandMark icon={site.icon} /></span>
          <span className="rail-expand"><FoldIcon /></span>
        </button>
        <div className="rail">
          {blocks.map(block => block.items.map(railChoice))}
          <div className="rail-foot">
            {groups.footer.map(group => railChoice({ id: group.id, label: group.label, placement: 'nav', order: group.order, icon: group.icon, section: '' }))}
          </div>
        </div>
      </div>
  ) : (
    <div className={`smp-shell${props.collapsed ? ' is-closing' : ''}`} style={{ width: wide.current }}>
      <div className="logo">
        <span className="logo-mark has-icon"><BrandMark icon={site.icon} /></span>
        <span className="logo-name">{site.title}</span>
        <button className="fold" type="button" aria-label={copy.collapse} onClick={props.toggleSidebar}><FoldIcon /></button>
      </div>
      <nav className="nav">
        {blocks.map(block => (
          <div className="menu-block" key={block.id}>
            {block.title !== '' && <div className="nav-title">{block.title}</div>}
            {block.items.map(item => {
              const group = byId.get(item.id)
              return group?.navigation === 'sidebar'
                ? <SidebarGroup key={item.id} item={item} group={group} current={onConversation ? '' : current} onOpen={props.openConsole} />
                : <OptionButton key={item.id} item={item} on={itemOn(item)} onOpen={() => openItem(item.id)} />
            })}
          </div>
        ))}
      </nav>
      {groups.footer.length > 0 && (
        <div className="nav-foot">
          {groups.footer.map(group => {
            const item: PlacedOption = { id: group.id, label: group.label, placement: 'nav', order: group.order, icon: group.icon, section: '' }
            return group.navigation === 'sidebar'
              ? <SidebarGroup key={group.id} item={item} group={group} current={onConversation ? '' : current} onOpen={props.openConsole} />
              : <OptionButton key={group.id} item={item} on={itemOn(item)} onOpen={() => openItem(group.id)} />
          })}
        </div>
      )}
    </div>
  )
  return (
    <>
      {column}
      <OfficialSessions mount={props.chatSide} groups={props.groups} renderSlot={props.renderSlot} />
    </>
  )
}

function OptionButton(props: { item: PlacedOption; on: boolean; onOpen: () => void }) {
  return (
    <button className={`nav-item${props.on ? ' is-on' : ''}`} type="button" onClick={props.onOpen}>
      <NavGlyph name={props.item.icon === '' ? 'box' : props.item.icon} />
      <span>{props.item.label}</span>
    </button>
  )
}

function SidebarGroup(props: { item: PlacedOption; group: NavGroup; current: string; onOpen: (key: string) => void }) {
  const active = props.group.pages.some(page => page.key === props.current)
  const [expanded, setExpanded] = useState(active)
  const id = useId()
  useEffect(() => {
    if (active) setExpanded(true)
  }, [active, props.current])
  return (
    <div className={`nav-group${expanded ? ' is-open' : ''}`}>
      <button
        className={`nav-item nav-parent${active ? ' is-active' : ''}`}
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(value => !value)}
      >
        <NavGlyph name={props.item.icon === '' ? 'box' : props.item.icon} />
        <span>{props.item.label}</span>
        <span className="nav-chevron" aria-hidden="true" />
      </button>
      <div id={id} role="group" aria-label={props.item.label} hidden={!expanded}>
        {expanded && (
          <div className="nav-sub">
            {props.group.pages.map(page => (
              <button
                key={page.key}
                className={`nav-sub-item${page.key === props.current ? ' is-on' : ''}`}
                type="button"
                aria-current={page.key === props.current ? 'page' : undefined}
                onClick={() => props.onOpen(page.key)}
              >
                {page.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LoginRedirect() {
  window.location.replace('/login')
  return null
}

function ConversationChrome(props: {
  locale: LocaleFace
  openConsole: (id: string) => void
  chatSide: ChatSideMount
}) {
  const copy = useCopy(props.locale)
  return (
    <>
      <header className="smp-chat-bar">
        <nav className="tabs" aria-label={copy.harness}>
          <button className="tab is-on" type="button" onClick={() => props.openConsole(AGENT_CHAT)}>{copy.chat}</button>
          <button className="tab" type="button" onClick={() => props.openConsole(ARCHIVE_PAGE)}>{copy.archive}</button>
        </nav>
      </header>
      <div style={{ display: 'contents' }} ref={props.chatSide.set} />
    </>
  )
}

function EmptyPage() {
  return null
}

function ConsolePanel(props: { slots: PageSlots; locale: LocaleFace; section: SectionStore; auth: AuthStore; groups: GroupFace; openConsole: (id: string) => void; renderSlot?: RenderSlot }) {
  const current = useSyncExternalStore(props.section.subscribe, props.section.get)
  const auth = useSyncExternalStore(props.auth.subscribe, props.auth.get)
  const hidden = useSyncExternalStore(props.groups.subscribe, props.groups.hiddenPages)
  const pages = withoutPages(usePages(props.slots, props.locale), hidden)
  const copy = useCopy(props.locale)
  const group = groupOf(pages, current)
  const tabs = group?.navigation === 'sidebar'
    ? group.pages.filter(page => page.key === current)
    : group?.pages ?? []
  const body = props.renderSlot?.('console.page', {openConsole:props.openConsole}, { entryKey: current }) ?? null
  const navigation = (
    <nav className="tabs" aria-label={group?.label}>
      {tabs.map(page => (
        <button key={page.key} className={`tab${page.key === current ? ' is-on' : ''}`} type="button" aria-current={page.key === current ? 'page' : undefined} onClick={() => props.openConsole(page.key)}>
          {page.label}
        </button>
      ))}
    </nav>
  )
  return (
    <div className="smp-console">
      {auth.authenticated && (
        <header className="topbar">
          {props.renderSlot?.('console.page-navigation', { openConsole: props.openConsole }, { entryKey: current, fallback: navigation }) ?? navigation}
          <button className="link" type="button" onClick={() => { void props.auth.logout().then(() => { window.location.assign('/login') }) }}>{copy.logout}</button>
        </header>
      )}
      <div className="content">
        {auth.checked && auth.authenticated && (
          <>
            {auth.passwordIsDefault && <p className="banner">{copy.banner}</p>}
            {props.renderSlot?.('console.settings-host', { page: current })}
            {body}
          </>
        )}
        {auth.checked && !auth.authenticated ? <LoginRedirect /> : null}
      </div>
    </div>
  )
}

export const inject = ['slots', 'layout', 'locale', 'theme', 'workspaceGroups']

export function apply(ctx: ShellCtx): void {
  const section = createSection(AGENT_CHAT)
  const auth = createAuth()
  const site = createSiteStore()
  const menu = createMenuStore()
  const landing = createLandingStore()
  const chatSide = createChatSideMount()
  ctx.effect(() => () => { chatSide.get()?.remove() })
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@smp/console-frame'
    tag.textContent = SHELL_STYLE + sidebarFlyoutCss + consoleCss
    document.head.appendChild(tag)
    void auth.refresh()
    void site.refresh().catch((cause: unknown) => { void cause })
    void menu.refresh().catch((cause: unknown) => { void cause })
    return () => { tag.remove() }
  })
  let chosen = false
  const show = (id: string): void => {
    section.set(id)
    ctx.layout.selectPanel(id === AGENT_CHAT ? null : CONSOLE_PANEL)
  }
  const openConsole = (id: string): void => {
    chosen = true
    show(id)
  }
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    priority: -100,
    // ui-sidebar is disabled, so this entry declares the workspace browser slot.
    // The workspace plugin fills it; the shell paints that entry under the chat tabs.
    children: {
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
    },
    inject: () => ({
      slots: ctx.slots,
      locale: ctx.locale,
      section,
      openConsole,
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
      site,
      menu,
      landing,
      chatSide,
      groups: ctx.workspaceGroups,
    }),
  }, ShellSidebar))
  ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
    name: 'conversation.header.leading',
    inject: () => ({
      locale: ctx.locale,
      openConsole,
      chatSide,
    }),
  }, ConversationChrome))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'workspace-groups-empty' }, () => (
    <div style={{ position: 'relative', height: '100%', paddingLeft: 280, paddingTop: 49 }}>
      <ConversationChrome locale={ctx.locale} openConsole={openConsole} chatSide={chatSide} />
      <p style={{ padding: 32, textAlign: 'center' }}>{ctx.locale.getSnapshot().active === 'zh' ? '未归属组没有可打开的会话' : 'No available unassigned sessions'}</p>
    </div>
  )))
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({
      name: 'main',
      key: CONSOLE_PANEL,
      children: {
        'console.page': { kind: 'keyed', scope: 'root' },
        'console.page-navigation': { kind: 'keyed', scope: 'root' },
        'console.settings-host': { kind: 'single', scope: 'root' },
      },
    }, (props: { renderSlot?: RenderSlot }) => <ConsolePanel slots={ctx.slots} locale={ctx.locale} section={section} auth={auth} groups={ctx.workspaceGroups} openConsole={openConsole} renderSlot={props.renderSlot} />)
    void landing.refresh().finally(() => {
      if (!chosen) show(landing.get().page)
    })
    return dispose
  })
  const theme: ThemeFace = {
    getTheme: () => ctx.theme.getTheme(),
    setTheme: (id) => { ctx.theme.setTheme(id) },
    subscribe: (listener) => ctx.on('theme/change', listener),
  }
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: SECURITY_PAGE,
    label: pageLabel(() => shellCopy(ctx.locale.getSnapshot().active).security, {
      group: PLATFORM_GROUP,
      groupLabel: () => shellCopy(ctx.locale.getSnapshot().active).platform,
      placement: 'footer',
      icon: 'settings',
    }),
    order: 5,
  }, () => <SecurityView auth={auth} locale={ctx.locale} />))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: GENERAL_PAGE,
    label: pageLabel(() => shellCopy(ctx.locale.getSnapshot().active).general, {
      group: PLATFORM_GROUP,
      groupLabel: () => shellCopy(ctx.locale.getSnapshot().active).platform,
      placement: 'footer',
      icon: 'settings',
    }),
    order: 0,
  }, () => <GeneralView slots={ctx.slots} locale={ctx.locale} theme={theme} site={site} landing={landing} />))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: MENU_PAGE,
    label: pageLabel(() => shellCopy(ctx.locale.getSnapshot().active).menu, {
      group: PLATFORM_GROUP,
      groupLabel: () => shellCopy(ctx.locale.getSnapshot().active).platform,
      placement: 'footer',
      icon: 'settings',
    }),
    order: 2,
  }, () => <MenuView slots={ctx.slots} locale={ctx.locale} menu={menu} />))
  const harnessLabel = () => shellCopy(ctx.locale.getSnapshot().active).harness
  registerNested(ctx, AGENT_CHAT, () => shellCopy(ctx.locale.getSnapshot().active).chat, AGENT_GROUP, harnessLabel, 0)
  // The archive plugin registers this page. A second registration of the same key throws.
}

function registerNested(ctx: ShellCtx, key: string, label: () => string, group: string, groupLabel: () => string, order: number): void {
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key,
    label: pageLabel(label, { group, groupLabel }),
    order,
  }, EmptyPage))
}
