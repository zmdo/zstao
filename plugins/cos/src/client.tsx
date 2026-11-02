import { AuditPage, FilesPage, SettingsPage, type LocaleFace } from './client/pages.tsx'
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
}

interface PageLabel {
  (): string
  group?: string
  groupLabel?: string
  navigation?: 'tabs' | 'sidebar'
  placement?: 'footer'
  icon?: string
}

export const inject = ['slots', 'locale']

function pageLabel(text: () => string, place: { group: string; groupLabel: string; navigation?: 'tabs' | 'sidebar'; placement?: 'footer'; icon?: string }): PageLabel {
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
  const place = { group: 'cos', groupLabel: copy().groupTitle, navigation: 'sidebar' as const }

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
        label: pageLabel(() => copy().settingsTitle, { group: 'platform', groupLabel: '平台设置', placement: 'footer', icon: 'settings' }),
        order: 8,
        inject: () => ({ locale: ctx.locale }),
      },
      SettingsPage,
    ),
  )
}
