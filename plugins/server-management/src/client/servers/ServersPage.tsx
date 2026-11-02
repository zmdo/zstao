import { useCallback, useSyncExternalStore } from 'react'
import { type LocaleFace } from '../../shared/i18n.ts'
import { useActiveLocale } from '../shared/locale.ts'
import type { ServerListView as ListView, ServerPageState } from '../shared/server-page-state.ts'
import { ServerForm } from './form/ServerForm.tsx'
import { ServerList } from './list/ServerList.tsx'
import { ServerWorkspace } from './workspace/ServerWorkspace.tsx'
import type { RenderSlot, SlotService } from '../extensions/slots.ts'

export function ServersPage(props: {
  locale: LocaleFace
  pageState: ServerPageState
  openConsole?: (key: string) => void
  renderSlot?: RenderSlot
  slots?: SlotService
}) {
  const active = useActiveLocale(props.locale)
  const { screen, serverId, editing, listView } = useSyncExternalStore(
    props.pageState.subscribe,
    props.pageState.getSnapshot,
  )
  const setListView = useCallback(
    (listView: ListView) => props.pageState.update({ listView }),
    [props.pageState],
  )
  if (screen === 'form') {
    return (
      <ServerForm
        active={active}
        editing={editing}
        serverId={serverId}
        initialGroupId={listView.groupId ?? ''}
        onDone={(id) => {
          if (id === '') props.pageState.update({ screen: 'list', serverId: '', editing: false })
          else props.pageState.openServer(id)
        }}
        onCancel={() => {
          if (serverId === '') props.pageState.update({ screen: 'list', editing: false })
          else props.pageState.update({ screen: 'detail', editing: false })
        }}
      />
    )
  }
  if (screen === 'detail')
    return (
      <ServerWorkspace
        key={serverId}
        active={active}
        serverId={serverId}
        pageState={props.pageState}
        renderSlot={props.renderSlot}
        slots={props.slots}
        onBack={() => props.pageState.closeWorkspace()}
        onUpgrades={(id) => {
          props.pageState.update({
            upgradeContext: { serverId: id },
            upgradeView: { tab: 'suggestions', page: 1, planId: '' },
          })
          props.openConsole?.('server-upgrades')
        }}
      />
    )
  return (
    <ServerList
      active={active}
      view={listView}
      onView={setListView}
      onUpgrades={() => {
        props.pageState.update({
          upgradeContext: { groupId: listView.groupId || undefined },
          upgradeView: { tab: 'suggestions', page: 1, planId: '' },
        })
        props.openConsole?.('server-upgrades')
      }}
      onOpen={(id) => {
        props.pageState.openServer(id)
      }}
      onTerminal={(id) => {
        props.pageState.update({ screen: 'detail', serverId: id, editing: false, detailPanel: 'terminal' })
      }}
      onCreate={() => {
        props.pageState.update({
          screen: 'form',
          serverId: '',
          editing: false,
          detailPanel: 'detail',
        })
      }}
    />
  )
}
