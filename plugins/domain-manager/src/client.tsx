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

export const inject = ['slots', 'locale']

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
  // The sidebar reads the icon off the label function, like pages carry their group.
  const label: (() => string) & { icon?: string } = () => copyFor(ctx.locale.getSnapshot().active).title
  label.icon = 'globe'
  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'domain-manager',
        label,
        order: 4,
        inject: () => ({ locale: ctx.locale }),
      },
      DomainsPage,
    ),
  )
}
