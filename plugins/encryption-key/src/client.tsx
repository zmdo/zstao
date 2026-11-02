import { dataTabLabel } from './copy.ts'
import { pageLabel } from './page-label.ts'
import { DataPage, installDataStyle } from './pages/DataPage.tsx'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface DataClient {
  slots: PageSlots
  locale: LocaleFace
  effect(run: () => (() => void)): void
}

const DATA_PAGE = 'data'

export const inject = ['slots', 'locale']

export function apply(ctx: DataClient): void {
  ctx.effect(installDataStyle)
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: DATA_PAGE,
    label: pageLabel(
      () => dataTabLabel(ctx.locale.getSnapshot().active),
      { group: 'platform', groupLabel: '平台设置', placement: 'footer' },
    ),
    order: 4,
    inject: () => ({ locale: ctx.locale }),
  }, DataPage))
}
