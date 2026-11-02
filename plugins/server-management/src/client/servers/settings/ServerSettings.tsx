import { Panel } from '@smp/console-kit'
import { useEffect, useState } from 'react'
import type { ServerDto } from '../../../shared/dto/servers.ts'
import { localized, serverCopy } from '../../../shared/i18n.ts'
import { useServerForm } from '../form/useServerForm.ts'
import { ExtensionSettingsSection } from '../../extensions/ExtensionSettingsSection.tsx'
import type { ExtensionCatalogEntry, RenderSlot, SlotService } from '../../extensions/slots.ts'
import { BasicSettings } from './BasicSettings.tsx'
import { PolicySettings } from './PolicySettings.tsx'

export function ServerSettings(props: {
  active: string
  serverId: string
  server: ServerDto
  extensions?: readonly ExtensionCatalogEntry[]
  renderSlot?: RenderSlot
  slots?: SlotService
  onSaved: () => void
  onDeleted: () => void
}) {
  const { active, serverId } = props
  const copy = serverCopy(active).ui
  const [section, setSection] = useState<string>('basic')
  const [visited, setVisited] = useState<Set<string>>(() => new Set())
  const extensions = props.extensions ?? []
  const form = useServerForm({
    active,
    editing: true,
    serverId,
    initialGroupId: props.server.group_id ?? '',
    onDone: () => {},
    onCancel: () => {},
    onSaved: props.onSaved,
  })
  const server = form.loadedServer ?? props.server
  useEffect(() => {
    if (section.startsWith('extension:') && !extensions.some((entry) => `extension:${entry.key}` === section))
      setSection('basic')
  }, [extensions, section])
  const tabs = [
    { key: 'basic', label: copy.basicConfig },
    { key: 'policies', label: copy.policiesConfig },
    ...extensions.map((entry) => ({ key: `extension:${entry.key}`, label: localized(entry.name, active) })),
  ]
  return (
    <Panel className="smp-server-settings-panel">
      <nav className="smp-settings-tabs" aria-label={copy.configuration}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={section === tab.key}
            className={`smp-settings-tab${section === tab.key ? ' is-on' : ''}`}
            onClick={() => {
              setVisited((previous) => new Set([...previous, tab.key]))
              setSection(tab.key)
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="smp-settings-content">
        {section === 'basic' ? (
          <BasicSettings active={active} form={form} server={server} onDeleted={props.onDeleted} />
        ) : section === 'policies' ? (
          <PolicySettings active={active} form={form} />
        ) : null}
        {extensions.filter((entry) => visited.has(`extension:${entry.key}`)).map((entry) => (
          <div className="smp-settings-pane" key={`${serverId}:${entry.key}`} hidden={section !== `extension:${entry.key}`}>
            <ExtensionSettingsSection
              active={active}
              server={server}
              entry={entry}
              renderSlot={props.renderSlot}
              slots={props.slots}
              onSaved={props.onSaved}
            />
          </div>
        ))}
      </div>
    </Panel>
  )
}
