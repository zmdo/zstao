import { modelsTabLabel } from './label.ts'
import { pageLabel } from './page-label.ts'
import { installModelsStyle, ModelsPage } from './pages/ModelsPage.tsx'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface ModelsClient {
  slots: PageSlots
  locale: LocaleFace
  remote: {
    llm: unknown
    settings: unknown
    credentials: unknown
  }
  effect(run: () => (() => void)): void
}

const MODELS_PAGE = 'models'

export const inject = ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings', 'remote.credentials']

export function apply(ctx: ModelsClient): void {
  ctx.effect(installModelsStyle)
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: MODELS_PAGE,
    label: pageLabel(
      () => modelsTabLabel(ctx.locale.getSnapshot().active),
      { group: 'platform', groupLabel: '平台设置', placement: 'footer' },
    ),
    order: 8,
    inject: () => ({
      locale: ctx.locale,
      llm: ctx.remote.llm,
      settings: ctx.remote.settings,
      credentials: ctx.remote.credentials,
    }),
  }, ModelsPage))
}
