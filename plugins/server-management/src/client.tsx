import { AuditPage } from './client/audit/AuditPage.tsx'
import { ExecutionSettings } from './client/settings/ExecutionSettings.tsx'
import { KeysPage } from './client/keys/KeysPage.tsx'
import { ServersPage } from './client/servers/ServersPage.tsx'
import { pageLabel } from './client/shared/page-label.ts'
import { createServerPageState } from './client/shared/server-page-state.ts'
import { installServersStyle } from './client/shared/styles.ts'
import { UpgradesNavigation } from './client/upgrades/UpgradesNavigation.tsx'
import { UpgradesPage } from './client/upgrades/UpgradesPage.tsx'
import { serverCopy, type LocaleFace } from './shared/i18n.ts'
interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
  entriesOfSlot(name: string): readonly { options: { key?: string; priority?: number } }[]
  subscribe(name: string, listener: () => void): () => void
}

interface ClientCtx {
  slots: PageSlots
  locale: LocaleFace
  effect(run: () => () => void): void
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientCtx): void {
  const pageState = createServerPageState()
  ctx.effect(() => () => pageState.dispose())
  const copy = () => serverCopy(ctx.locale.getSnapshot().active).ui
  const group = {
    group: 'server-management',
    groupLabel: () => copy().groupTitle,
    navigation: 'sidebar' as const,
  }
  ctx.effect(installServersStyle)
  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'servers',
        label: pageLabel(() => copy().serversTab, { ...group, icon: 'server' }),
        order: 0,
        children: {
          'server-management.detail.panel': { kind: 'keyed', scope: 'root' },
          'server-management.settings.section': { kind: 'keyed', scope: 'root' },
        },
        inject: () => ({ locale: ctx.locale, pageState, slots: ctx.slots }),
      },
      ServersPage,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'server',
        order: 20,
        label: () => copy().settingsServer,
        inject: () => ({ locale: ctx.locale }),
      },
      ExecutionSettings,
    ),
  )
  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'server-audit',
        label: pageLabel(() => copy().auditTab, group),
        order: 3,
        inject: () => ({ locale: ctx.locale, pageState }),
      },
      AuditPage,
    ),
  )
  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'server-upgrades',
        label: pageLabel(() => serverCopy(ctx.locale.getSnapshot().active).upgrades.title, group),
        order: 2,
        inject: () => ({ locale: ctx.locale, pageState }),
      },
      UpgradesPage,
    ),
  )
  ctx.slots.inject('console.page-navigation', () =>
    ctx.slots.register(
      {
        name: 'console.page-navigation',
        key: 'server-upgrades',
        inject: () => ({ locale: ctx.locale, pageState }),
      },
      UpgradesNavigation,
    ),
  )
  ctx.slots.inject('console.page', () =>
    ctx.slots.register(
      {
        name: 'console.page',
        key: 'ssh-keys',
        label: pageLabel(() => copy().keysTab, group),
        order: 1,
        inject: () => ({ locale: ctx.locale }),
      },
      KeysPage,
    ),
  )
}

export { registerServerPanel, registerSettingsSection } from './client/extensions/slots.ts'
export { extensionApi } from './client/extensions/api.ts'
