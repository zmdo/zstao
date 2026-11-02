import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { generalRowIds, sectionNav, type RegisteredSection } from '../sections.ts'

interface SectionSlots {
  entries(key: string): readonly RegisteredSection[]
  subscribe(key: string, listener: () => void): () => void
}

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface RenderSlot {
  (name: string, props: object, options?: { only?: string }): ReactNode
}

const STYLE = `
.smp-console .content:has(.smp-settings-shell) { display: flex; flex-direction: column; }
.smp-settings-shell {
  flex: 1; min-height: 0; display: flex; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--line); border-radius: 4px; overflow: hidden;
  font-size: 14px; line-height: 22px;
}
.smp-settings-nav {
  width: 188px; flex: none; display: flex; flex-direction: column; gap: 4px;
  padding: 16px 10px; border-right: 1px solid var(--line); overflow: auto;
}
.smp-settings-item {
  height: 36px; padding: 0 12px; border: 0; border-radius: 4px; background: transparent;
  text-align: left; color: var(--dsw-alias-label-primary); cursor: pointer;
}
.smp-settings-item:hover { background: var(--dsw-specific-sidebar-nav-item-hover); }
.smp-settings-item.is-on { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
.smp-settings-body { flex: 1; min-width: 0; overflow: auto; padding: 20px 28px 32px; }
.smp-console .smp-settings-body [data-slot="settings.section"] > * { max-width: 760px; }
.smp-console .smp-settings-body [data-plugin-scope="global"] { display: none; }
.smp-settings-empty { margin: 0; color: var(--muted); }
`

function closeSettings(): void {}

function useEntries(slots: SectionSlots, key: string): readonly RegisteredSection[] {
  return useSyncExternalStore(
    listener => slots.subscribe(key, listener),
    () => slots.entries(key),
  )
}

export function GeneralSection(props: { slots: SectionSlots; renderSlot?: RenderSlot }) {
  const rows = generalRowIds(useEntries(props.slots, 'settings.general.item'))
  return (
    <div>
      {rows.map(id => (
        <div key={id}>{props.renderSlot?.('settings.general.item', {}, { only: id })}</div>
      ))}
    </div>
  )
}

const HARNESS_PAGE = 'harness'

/** Stays mounted so Harness settings can draw sections. The models tab draws itself. */
export function SettingsHost(props: { page?: string; slots: SectionSlots; locale: LocaleFace; renderSlot?: RenderSlot }) {
  if (props.page === HARNESS_PAGE) return <SettingsShell slots={props.slots} locale={props.locale} renderSlot={props.renderSlot} />
  return null
}

export function SettingsShell(props: { slots: SectionSlots; locale: LocaleFace; renderSlot?: RenderSlot }) {
  const entries = useEntries(props.slots, 'settings.section')
  const locale = useSyncExternalStore(listener => props.locale.subscribe(listener), () => props.locale.getSnapshot())
  const sections = sectionNav(entries)
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const active = sections.some(section => section.id === picked) ? picked : sections[0]?.id
  const zh = locale.active === 'zh'
  return (
    <div className="smp-settings-shell">
      <nav className="smp-settings-nav" aria-label="Harness">
        {sections.map(section => (
          <button
            key={section.id}
            className={`smp-settings-item${section.id === active ? ' is-on' : ''}`}
            type="button"
            aria-current={section.id === active ? 'true' : undefined}
            onClick={() => setPicked(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>
      <div className="smp-settings-body">
        {active === undefined
          ? <p className="smp-settings-empty">{zh ? '没有已登记的设置' : 'No settings are registered'}</p>
          : props.renderSlot?.('settings.section', { close: closeSettings }, { only: active })}
      </div>
    </div>
  )
}

export function installStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-harness-settings'
  tag.textContent = STYLE
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
