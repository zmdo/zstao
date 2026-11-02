import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { displayError, localized, serverCopy } from '../../../shared/i18n.ts'
import { ServerError } from '../../../shared/errors.ts'
import { api, requestError } from '../../shared/api.ts'
import type { DetailPanel, ServerPageState, TaskViewState } from '../../shared/server-page-state.ts'
import { ServerStatus } from '../components/ServerStatus.tsx'
import { ServerDetail } from '../detail/ServerDetail.tsx'
import { ServerSettings } from '../settings/ServerSettings.tsx'
import { ServerTerminal } from '../terminal/ServerTerminal.tsx'
import { TaskHistory } from '../tasks/TaskHistory.tsx'
import { ExtensionHost } from '../../extensions/ExtensionHost.tsx'
import { DETAIL_PANEL_SLOT, SETTINGS_SECTION_SLOT } from '../../extensions/slots.ts'
import { extensionApi } from '../../extensions/api.ts'
import type { ExtensionCatalogEntry, RenderSlot, SlotService } from '../../extensions/slots.ts'
import { useServerResource } from './useServerResource.ts'

export function ServerWorkspace(props: {
  active: string
  serverId: string
  pageState: ServerPageState
  onBack: () => void
  onUpgrades: (serverId: string) => void
  renderSlot?: RenderSlot
  slots?: SlotService
}) {
  const { active, pageState, serverId } = props
  const snapshot = useSyncExternalStore(pageState.subscribe, pageState.getSnapshot)
  const panel = snapshot.detailPanel
  const copy = serverCopy(active).ui
  const { server, error, refresh } = useServerResource(serverId)
  const [queued, setQueued] = useState(false)
  const [actionError, setActionError] = useState<ServerError | null>(null)
  const [terminalOpened, setTerminalOpened] = useState(false)
  const [settingsOpened, setSettingsOpened] = useState(false)
  const [extensions, setExtensions] = useState<ExtensionCatalogEntry[]>([])
  const [extensionsLoaded, setExtensionsLoaded] = useState(false)
  const [slotVersion, setSlotVersion] = useState(0)
  const [terminalEpoch, setTerminalEpoch] = useState(0)
  const [terminalAutoConnect, setTerminalAutoConnect] = useState(true)
  const previousIdentity = useRef('')
  const taskView = pageState.taskView(serverId)
  const setTaskView = useCallback(
    (view: TaskViewState) => {
      pageState.setTaskView(serverId, view)
    },
    [pageState, serverId],
  )

  useEffect(() => {
    if (error?.code === 'server_not_found') props.onBack()
  }, [error?.code, props.onBack])
  const identity = server === undefined ? '' : terminalIdentity(server)
  useEffect(() => {
    if (identity === '') return
    if (previousIdentity.current === '') {
      previousIdentity.current = identity
      return
    }
    if (previousIdentity.current === identity) return
    previousIdentity.current = identity
    if (!terminalOpened) return
    // A changed host, user or key must not silently reuse the old terminal.
    setTerminalAutoConnect(false)
    setTerminalEpoch((value) => value + 1)
  }, [identity, terminalOpened])

  useEffect(() => {
    if (panel === 'terminal') setTerminalOpened(true)
    if (panel === 'config') setSettingsOpened(true)
  }, [panel])

  useEffect(() => {
    if (props.slots === undefined) return
    const bump = () => setSlotVersion((value) => value + 1)
    const offPanel = props.slots.subscribe(DETAIL_PANEL_SLOT, bump)
    const offSettings = props.slots.subscribe(SETTINGS_SECTION_SLOT, bump)
    return () => {
      offPanel()
      offSettings()
    }
  }, [props.slots])

  const extensionType = server?.type_key ?? ''
  const extensionOs = JSON.stringify(server?.declared_os ?? null)
  useEffect(() => {
    if (extensionType === '') {
      setExtensions([])
      setExtensionsLoaded(false)
      return
    }
    let stopped = false
    const controller = new AbortController()
    setExtensions([])
    setExtensionsLoaded(false)
    void api<{ items: ExtensionCatalogEntry[] }>(`/console-api/servers/${serverId}/extensions`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (stopped) return
        setExtensions(result.items)
        setExtensionsLoaded(true)
      })
      .catch((cause) => {
        if (stopped) return
        if ((cause as { name?: string }).name !== 'AbortError') setExtensionsLoaded(true)
      })
    return () => {
      stopped = true
      controller.abort()
    }
  }, [extensionOs, extensionType, serverId, slotVersion])

  const extensionKey = panel.startsWith('extension:') ? panel.slice('extension:'.length) : ''
  const selectedExtension = extensions.find((entry) => entry.kind === 'panel' && entry.key === extensionKey)
  useEffect(() => {
    if (extensionKey !== '' && extensionsLoaded && selectedExtension === undefined)
      pageState.selectDetailPanel('detail')
  }, [extensionKey, extensionsLoaded, pageState, selectedExtension])

  async function act(path: string): Promise<void> {
    setActionError(null)
    setQueued(false)
    try {
      await api(path, { method: 'POST' })
      setQueued(true)
      refresh()
    } catch (cause) {
      setActionError(requestError(cause))
    }
  }


  const choices: { key: DetailPanel; label: string; select: () => void }[] = [
    {
      key: 'detail',
      label: copy.serverDetails,
      select: () => pageState.selectDetailPanel('detail'),
    },
    {
      key: 'tasks',
      label: copy.taskReport,
      select: () => pageState.selectDetailPanel('tasks'),
    },
    { key: 'terminal', label: copy.terminal, select: () => pageState.selectDetailPanel('terminal') },
    { key: 'config', label: copy.configuration, select: () => pageState.selectDetailPanel('config') },
    ...extensions
      .filter((entry) => entry.kind === 'panel')
      .map((entry) => ({
        key: `extension:${entry.key}` as DetailPanel,
        label: localized(entry.name, active),
        select: () => pageState.selectDetailPanel(`extension:${entry.key}`),
      })),
  ]

  return (
    <div className="smp-server-workspace">
      <header className="smp-server-workspace-head">
        <button className="link" type="button" onClick={props.onBack}>
          {copy.back}
        </button>
        <div className="smp-server-workspace-identity">
          <h2>{server?.name ?? copy.server}</h2>
          {server && (
            <span className="mono">
              {server.host}:{server.ssh_port}
            </span>
          )}
        </div>
        {server && <ServerStatus active={active} status={server.status} />}
      </header>
      {server === undefined ? (
        <section className="smp-server-workspace-panel">
          <Panel>
            <p className="muted">{error === null ? copy.loading : displayError(active, error)}</p>
          </Panel>
        </section>
      ) : (
        <div className="smp-server-workspace-body">
          <aside className="smp-server-workspace-nav">
            <nav aria-label={copy.workspacePanels}>
              {choices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  className={`smp-server-workspace-choice${panel === choice.key ? ' is-on' : ''}`}
                  aria-current={panel === choice.key ? 'page' : undefined}
                  onClick={choice.select}
                >
                  {choice.label}
                </button>
              ))}
            </nav>
          </aside>
          <label className="smp-server-workspace-select-wrap">
            <span>{copy.workspacePanels}</span>
            <select
              className="smp-server-workspace-select"
              aria-label={copy.workspacePanels}
              value={panel}
              onChange={(event) => {
                const choice = choices.find((item) => item.key === event.target.value)
                choice?.select()
              }}
            >
              {choices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <section className="smp-server-workspace-panel">
            {terminalOpened && (
              <div className="smp-server-terminal-layer" hidden={panel !== 'terminal'}>
                <ServerTerminal
                  key={`${serverId}:${terminalEpoch}`}
                  active={active}
                  id={serverId}
                  visible={panel === 'terminal'}
                  autoConnect={terminalAutoConnect}
                  embedded
                  onBack={() => pageState.selectDetailPanel('detail')}
                />
              </div>
            )}
            {settingsOpened && (
              <div className="smp-server-settings-layer" hidden={panel !== 'config'}>
                <ServerSettings
                  active={active}
                  serverId={serverId}
                  server={server}
                  extensions={extensions.filter((entry) => entry.kind === 'settings')}
                  renderSlot={props.renderSlot}
                  slots={props.slots}
                  onSaved={refresh}
                  onDeleted={props.onBack}
                />
              </div>
            )}
            {extensionKey !== '' && (
              <div className="smp-server-extension-layer">
                <ExtensionHost
                  active={active}
                  slot={DETAIL_PANEL_SLOT}
                  entry={extensionKey}
                  owner={{
                    server,
                    active,
                    refresh,
                    openTasks: () => pageState.selectDetailPanel('tasks'),
                    selectPanel: (key: string) => pageState.selectDetailPanel(key as DetailPanel),
                    api: extensionApi,
                  }}
                  renderSlot={props.renderSlot as never}
                  slots={props.slots}
                />
              </div>
            )}
            {panel === 'terminal' || panel === 'config' || extensionKey !== '' ? null : panel === 'tasks' ? (
              <Panel className="smp-task-panel">
                <TaskHistory
                  key={serverId}
                  active={active}
                  serverId={serverId}
                  view={taskView}
                  onView={setTaskView}
                />
              </Panel>
            ) : (
              <ServerDetail
                active={active}
                server={server}
                error={actionError ?? error}
                queued={queued}
                onTest={() => {
                  void act(`/console-api/servers/${serverId}/test`)
                }}
                onInspect={() => {
                  void act(`/console-api/servers/${serverId}/inspect`)
                }}
                onInstall={() => {
                  void act(`/console-api/servers/${serverId}/install-components`)
                }}
                onTerminal={() => pageState.selectDetailPanel('terminal')}
                onUpgrades={() => props.onUpgrades(serverId)}
              />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function terminalIdentity(server: {
  host: string
  ssh_port: number
  ssh_user: string
  auth_method: string
  ssh_key_id: string | null
  host_fingerprint: string | null
}): string {
  return JSON.stringify([
    server.host,
    server.ssh_port,
    server.ssh_user,
    server.auth_method,
    server.ssh_key_id,
    server.host_fingerprint,
  ])
}
