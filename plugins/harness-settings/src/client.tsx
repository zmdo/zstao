import { GeneralSection, SettingsHost, installStyle } from './pages/SettingsShell.tsx'
import { pageLabel } from './page-label.ts'

interface SectionSlots {
  entries(key: string): readonly { options: { id?: string; label?: string | (() => string); order?: number } }[]
  subscribe(key: string, listener: () => void): () => void
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface SettingsCtx {
  slots: SectionSlots
  locale: LocaleFace
  effect(run: () => (() => void)): void
}

const HARNESS_PAGE = 'harness'

export const inject = ['slots', 'locale']

export function apply(ctx: SettingsCtx): void {
  ctx.effect(installStyle)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    label: () => ctx.locale.getSnapshot().active === 'zh' ? '通用设置' : 'General',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ slots: ctx.slots }),
  }, GeneralSection))
  ctx.slots.inject('console.settings-host', () => ctx.slots.register({
    name: 'console.settings-host',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ slots: ctx.slots, locale: ctx.locale }),
  }, SettingsHost))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: HARNESS_PAGE,
    label: pageLabel(
      () => 'Harness',
      { group: 'platform', groupLabel: '平台设置', placement: 'footer' },
    ),
    order: 10,
  }, () => null))
}
