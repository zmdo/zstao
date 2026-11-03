import { AuditPage, FilesPage, SettingsPage, type LocaleFace } from './client/pages.tsx'
import { CosFilesBody, CosFilesTitle } from './client/sidebar.tsx'
import { copyFor } from './client/copy.ts'
import styles from './client/files.css'

interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface ClientCtx {
  slots: PageSlots
  locale: LocaleFace
  effect(run: () => () => void): void
  inject(names: string[], run: (scope: ClientCtx) => void): void
  shortcuts: {
    register(definition: {
      id: string
      label: () => string
      aliases?: string[]
      defaults?: Record<string, { code: string; modifiers: string[] }>
      regions: string[]
      modals: string[]
      resolve(input: { target: Element }): unknown
    }): () => void
  }
  sidebarRightTabs: { register(definition: object): () => void }
  sidebarRight: {
    openResource(address: string): void
    commandTarget(element: Element): unknown
    openTabFromTarget(kind: string, target: unknown): void
  }
}

const SIDEBAR_ID = 'smp-cos-sidebar'
const SIDEBAR_KIND = 'cos-files'

interface PageLabel {
  (): string
  group?: string
  groupLabel?: string | (() => string)
  navigation?: 'tabs' | 'sidebar'
  placement?: 'footer'
  icon?: string
}

export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

function pageLabel(text: () => string, place: { group: string; groupLabel: string | (() => string); navigation?: 'tabs' | 'sidebar'; placement?: 'footer'; icon?: string }): PageLabel {
  const label: PageLabel = () => text()
  label.group = place.group
  label.groupLabel = place.groupLabel
  if (place.navigation !== undefined) label.navigation = place.navigation
  if (place.placement !== undefined) label.placement = place.placement
  if (place.icon !== undefined) label.icon = place.icon
  return label
}

export function apply(ctx: ClientCtx): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@smp/console-cos'
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  })

  const copy = () => copyFor(ctx.locale.getSnapshot().active)
  // The group label must stay a function: the client locale starts from the
  // browser language and adopts the stored preference asynchronously, so a
  // value captured during apply would keep the first snapshot forever.
  const place = { group: 'cos', groupLabel: () => copy().groupTitle, navigation: 'sidebar' as const }

  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      { name: 'console.page', key: 'cos-files', label: pageLabel(() => copy().filesTitle, { ...place, icon: 'folder' }), order: 0, inject: () => ({ locale: ctx.locale }) },
      FilesPage,
    ),
  )
  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      { name: 'console.page', key: 'cos-audit', label: pageLabel(() => copy().auditTitle, { ...place, icon: 'audit' }), order: 1, inject: () => ({ locale: ctx.locale }) },
      AuditPage,
    ),
  )
  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'cos-settings',
        label: pageLabel(() => copy().settingsTitle, { group: 'platform', groupLabel: () => copy().platformTitle, placement: 'footer', icon: 'settings' }),
        order: 8,
        inject: () => ({ locale: ctx.locale }),
      },
      SettingsPage,
    ),
  )

  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: SIDEBAR_ID,
      kind: SIDEBAR_KIND,
      priority: 'extension',
      title: () => copy().sidebarTitle,
      keepMounted: true,
      guide: [
        {
          id: SIDEBAR_KIND,
          commandId: 'cos.files',
          order: 30,
          title: () => copy().sidebarTitle,
          description: () => copy().sidebarHint,
        },
      ],
    }),
  )
  ctx.inject(['shortcuts'], (scope) => {
    scope.effect(() =>
      scope.shortcuts.register({
        id: 'cos.files',
        label: () => copy().sidebarTitle,
        aliases: ['cos files', 'network files'],
        defaults: {
          'desktop:windows': { code: 'KeyO', modifiers: ['primary', 'shift'] },
          'desktop:macos': { code: 'KeyO', modifiers: ['primary', 'shift'] },
          'desktop:linux': { code: 'KeyO', modifiers: ['primary', 'shift'] },
          'web:windows': { code: 'KeyO', modifiers: ['primary', 'shift'] },
          'web:macos': { code: 'KeyO', modifiers: ['primary', 'shift'] },
        },
        regions: ['page', 'editable', 'terminal'],
        modals: [],
        resolve: ({ target }) => {
          const found = ctx.sidebarRight.commandTarget(target)
          if (found === undefined) return { status: 'blocked', reason: copy().sidebarNoSession }
          return { status: 'handled', run: () => ctx.sidebarRight.openTabFromTarget(SIDEBAR_KIND, found) }
        },
      }),
    )
  })
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: SIDEBAR_ID,
        inject: () => ({ locale: ctx.locale, open: (address: string) => ctx.sidebarRight.openResource(address) }),
      },
      CosFilesBody,
    ),
  )
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: SIDEBAR_ID }, CosFilesTitle))
}


