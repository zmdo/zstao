import { archiveTabLabel } from './copy.ts'
import { pageLabel } from './page-label.ts'
import { ArchivePage, installArchiveStyle, type ArchivePageProps } from './pages/ArchivePage.tsx'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface ArchiveClient {
  slots: PageSlots
  locale: LocaleFace
  sessions: ArchivePageProps['sessions']
  workspaces: ArchivePageProps['workspaces']
  uiWorkspace: ArchivePageProps['uiWorkspace']
  layout: ArchivePageProps['layout']
  workspaceGroups: ArchivePageProps['workspaceGroups']
  effect(run: () => (() => void)): void
}

const ARCHIVE_PAGE = 'archive'

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'layout', 'workspaceGroups']

export function apply(ctx: ArchiveClient): void {
  ctx.effect(installArchiveStyle)
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: ARCHIVE_PAGE,
    label: pageLabel(
      () => archiveTabLabel(ctx.locale.getSnapshot().active),
      { group: 'agent', groupLabel: 'Harness' },
    ),
    order: 1,
    inject: () => ({
      locale: ctx.locale,
      sessions: ctx.sessions,
      workspaces: ctx.workspaces,
      uiWorkspace: ctx.uiWorkspace,
      layout: ctx.layout,
      workspaceGroups: ctx.workspaceGroups,
    }),
  }, ArchivePage))
}
