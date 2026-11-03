import { DashboardPage, installDashboardStyle } from './client/DashboardPage.tsx'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface ClientCtx {
  slots: PageSlots
  locale: LocaleFace
  effect(run: () => (() => void)): void
}

interface PageLabel {
  (): string
  group?: string
  groupLabel?: string | (() => string)
  navigation?: 'tabs' | 'sidebar'
  icon?: string
}

function pageLabel(text: () => string, place: { group: string; groupLabel: string | (() => string); icon?: string }): PageLabel {
  const label: PageLabel = () => text()
  label.group = place.group
  label.groupLabel = place.groupLabel
  label.icon = place.icon
  return label
}

function copy(active: string) {
  return active === 'en'
    ? { title: 'Dashboard', group: 'Dashboard' }
    : { title: '仪表盘', group: '仪表盘' }
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientCtx): void {
  ctx.effect(installDashboardStyle)
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: 'dashboard',
    label: pageLabel(() => copy(ctx.locale.getSnapshot().active).title, {
      group: 'dashboard',
      groupLabel: () => copy(ctx.locale.getSnapshot().active).group,
      icon: 'chart',
    }),
    order: -2,
    inject: () => ({ locale: ctx.locale }),
  }, DashboardPage))
}
