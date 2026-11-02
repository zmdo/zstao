import type { Slots, SlotEntry } from './bridge.ts'

export const PICKER_SLOT = 'conversation.hero.workspace'
export const NATIVE_FLOW_SLOT = 'conversation.hero.workspace.directoryFlow'
export const GROUP_FLOW_SLOT = 'smp.workspace-groups.picker.directoryFlow'

/** Reuse the installed directory flow in an owned alias; the original child stays with its native entry. */
export function mirrorPickerFlow(slots: Slots): () => void {
  let current: SlotEntry | undefined
  let dispose: (() => void) | undefined
  const sync = () => {
    const entry = slots.entriesOfSlot(NATIVE_FLOW_SLOT)[0]
    if (current === entry) return
    dispose?.()
    current = entry
    dispose = entry === undefined ? undefined : slots.register({ name: GROUP_FLOW_SLOT, inject: entry.inject, locale: entry.locale, store: entry.store }, entry.component)
  }
  const stop = slots.subscribe(NATIVE_FLOW_SLOT, sync)
  sync()
  return () => { stop(); dispose?.() }
}
