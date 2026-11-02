import { AuditPage } from './client/AuditPage.tsx'
import { DomainsPage } from './client/DomainsPage.tsx'
import { copyFor } from './client/copy.ts'
import styles from './client/domains.css'
import type { LocaleFace } from './client/api.ts'

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
  icon?: string
}

export const inject = ['slots', 'locale']

/** Group and icon ride on the label function; the slot ledger keeps only `label`. */
function pageLabel(text: () => string, place: { group: string; groupLabel: string; navigation?: 'tabs' | 'sidebar'; icon?: string }): PageLabel {
  const label: PageLabel = () => text()
  label.group = place.group
  label.groupLabel = place.groupLabel
  if (place.navigation !== undefined) label.navigation = place.navigation
  if (place.icon !== undefined) label.icon = place.icon
  return label
}

export function apply(ctx: ClientCtx): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@smp/console-domain-manager'
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  })

  const text = (pick: (copy: ReturnType<typeof copyFor>) => string) => () => pick(copyFor(ctx.locale.getSnapshot().active))
  const place = {
    group: 'domain-manager',
    groupLabel: () => copyFor(ctx.locale.getSnapshot().active).groupTitle,
    navigation: 'sidebar' as const,
  }

  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'domain-manager',
        label: pageLabel(text((copy) => copy.instancesTitle), { ...place, icon: 'globe' }),
        order: 0,
        inject: () => ({ locale: ctx.locale }),
      },
      DomainsPage,
    ),
  )

  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'domain-audit',
        label: pageLabel(text((copy) => copy.auditTitle), { ...place, icon: 'audit' }),
        order: 1,
        inject: () => ({ locale: ctx.locale }),
      },
      AuditPage,
    ),
  )
}
