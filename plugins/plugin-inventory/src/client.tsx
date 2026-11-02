import { pluginsTabLabel } from './label.ts'
import { pageLabel } from './page-label.ts'
import { installPluginsStyle, PluginsPage } from './pages/PluginsPage.tsx'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface PluginsClient {
  slots: PageSlots
  locale: LocaleFace
  remote: { pluginInventory: unknown }
  effect(run: () => (() => void)): void
}

const PLUGINS_PAGE = 'plugins'

export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

export function apply(ctx: PluginsClient): void {
  ctx.effect(installPluginsStyle)
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: PLUGINS_PAGE,
    label: pageLabel(
      () => pluginsTabLabel(ctx.locale.getSnapshot().active),
      { group: 'platform', groupLabel: '平台设置', placement: 'footer' },
    ),
    order: 6,
    inject: () => ({
      locale: ctx.locale,
      inventory: ctx.remote.pluginInventory,
    }),
  }, PluginsPage))
}
