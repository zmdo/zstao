import type { ComponentType, ReactNode } from 'react'
import type { LocalizedText } from '../../shared/contracts/common.ts'
import type { ServerDto } from '../../shared/dto/servers.ts'
import type { ExtensionApi } from './api.ts'

export const DETAIL_PANEL_SLOT = 'server-management.detail.panel'
export const SETTINGS_SECTION_SLOT = 'server-management.settings.section'

export interface ExtensionSlotOwner {
  server: ServerDto
  active: string
  refresh: () => void
  openTasks: () => void
  selectPanel: (key: string) => void
  api: ExtensionApi
  settings?: {
    value: unknown
    revision: string
    dirty: boolean
    saving: boolean
    error: unknown
    onChange: (value: unknown) => void
  }
}

export interface SlotService {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
  entriesOfSlot(name: string): readonly { options: { key?: string; priority?: number } }[]
  entries?(name: string): readonly { options: { key?: string; priority?: number } }[]
  subscribe(name: string, listener: () => void): () => void
}

type RenderSlot = (
  key: string,
  owner: ExtensionSlotOwner,
  options: { entryKey?: string; fallback?: ReactNode },
) => ReactNode

/** Register a host-catalogued detail panel component. */
export function registerServerPanel(
  ctx: { slots: SlotService },
  key: string,
  component: ComponentType<ExtensionSlotOwner>,
  priority = 0,
): void {
  ctx.slots.inject(DETAIL_PANEL_SLOT, () =>
    ctx.slots.register({ name: DETAIL_PANEL_SLOT, key, priority }, component),
  )
}

/** Register a host-catalogued settings section component. */
export function registerSettingsSection(
  ctx: { slots: SlotService },
  key: string,
  component: ComponentType<ExtensionSlotOwner>,
  priority = 0,
): void {
  ctx.slots.inject(SETTINGS_SECTION_SLOT, () =>
    ctx.slots.register({ name: SETTINGS_SECTION_SLOT, key, priority }, component),
  )
}

export interface ExtensionCatalogEntry {
  key: string
  owner: string
  kind: 'panel' | 'settings' | 'query' | 'inspection'
  name: LocalizedText
  order: number
  affectsExecution?: boolean
}

export type { RenderSlot }
