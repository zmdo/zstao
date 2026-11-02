import { useState } from 'react'
import { Panel } from '@smp/console-kit'
import { Dialog as Modal, DialogButton as Button } from '@smp/console-kit/dialog'
import { displayError, format, groupName as localizedGroupName, serverCopy } from '../../../shared/i18n.ts'
import { SERVER_STATES } from '../../../shared/server-status.ts'
import type { ServerListView as ListView } from '../../shared/server-page-state.ts'
import { ServerLine } from './ServerLine.tsx'
import type { ServerListItem } from '../../../shared/dto/servers.ts'
import type { ServerListProps } from './useServerList.ts'
import { useServerList } from './useServerList.ts'
export function ServerList(props: ServerListProps) {
  const model = useServerList(props)
  const [removing, setRemoving] = useState<ServerListItem | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const {
    actionError,
    active,
    addingGroup,
    copy,
    counts,
    createGroup,
    creatingGroup,
    groupError,
    groupId,
    groupLabel,
    groupName,
    groups,
    loadError,
    loaded,
    onView,
    page,
    pages,
    removeGroup,
    removeServer,
    renameGroup,
    refreshing,
    retryConnections,
    rows,
    selectGroup,
    setAddingGroup,
    setGroupError,
    setGroupName,
    tableScroll,
    total,
    view,
  } = model

  return (
    <div className="smp-server-shell">
      <aside className="smp-server-sidebar">
        <header className="smp-server-group-head">
          <h2>{copy.groups}</h2>
          <button
            className="link"
            type="button"
            aria-expanded={addingGroup}
            onClick={() => {
              setAddingGroup(!addingGroup)
              setGroupError(null)
            }}
          >
            {copy.newGroup}
          </button>
        </header>
        {addingGroup && (
          <form
            className="smp-server-group-form"
            onSubmit={(event) => {
              void createGroup(event)
            }}
          >
            <input
              aria-label={copy.groupName}
              placeholder={copy.groupName}
              value={groupName}
              maxLength={80}
              required
              autoFocus
              disabled={creatingGroup}
              onChange={(event) => {
                setGroupName(event.target.value)
              }}
            />
            {groupError !== null && (
              <p className="smp-server-group-error" role="alert">
                {displayError(active, groupError)}
              </p>
            )}
            <div className="row">
              <button className="primary" type="submit" disabled={creatingGroup || groupName.trim() === ''}>
                {copy.create}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={creatingGroup}
                onClick={() => {
                  setAddingGroup(false)
                  setGroupName('')
                  setGroupError(null)
                }}
              >
                {copy.cancel}
              </button>
            </div>
          </form>
        )}
        <nav className="smp-server-groups" aria-label={copy.serverGroups}>
          <GroupChoice
            active={active}
            label={copy.allServers}
            count={counts.all}
            selected={groupId === null}
            onSelect={() => selectGroup(null)}
          />
          {groups.map((group) => (
            <GroupChoice
              active={active}
              key={group.id}
              label={localizedGroupName(active, group)}
              system={group.kind === 'system'}
              available={group.available}
              source={group.plugin_id ?? undefined}
              count={group.server_count}
              selected={groupId === group.id}
              onSelect={() => selectGroup(group.id)}
              renaming={renamingId === group.id}
              renameValue={renameValue}
              onRenameStart={group.kind === 'user' ? () => { setRenamingId(group.id); setRenameValue(localizedGroupName(active, group)) } : undefined}
              onRenameChange={group.kind === 'user' ? setRenameValue : undefined}
              onRenameCancel={group.kind === 'user' ? () => setRenamingId(null) : undefined}
              onRenameSave={group.kind === 'user' ? () => { void renameGroup(group.id, renameValue).then((ok) => { if (ok) setRenamingId(null) }) } : undefined}
              onDelete={
                group.kind === 'user'
                  ? () => {
                      void removeGroup(group.id)
                    }
                  : undefined
              }
            />
          ))}
          <GroupChoice
            active={active}
            label={copy.ungrouped}
            count={counts.ungrouped}
            selected={groupId === ''}
            onSelect={() => selectGroup('')}
          />
        </nav>
      </aside>
      <div className="smp-server-main">
        <Panel
          title={
            <>
              {copy.instances}
              <span className="smp-server-current-group">{groupLabel}</span>
            </>
          }
          extra={
            <div className="row smp-server-tools">
              <input
                type="search"
                className="search"
                aria-label={copy.searchServers}
                maxLength={200}
                value={view.query}
                placeholder={copy.searchServers}
                onChange={(event) => {
                  onView({ ...view, query: event.target.value, page: 1 })
                }}
              />
              <select
                aria-label={copy.filterServerStatus}
                value={view.status}
                onChange={(event) => onView({ ...view, status: event.target.value, page: 1 })}
              >
                <option value="">{copy.allStatuses}</option>
                {SERVER_STATES.map((state) => (
                  <option key={state} value={state}>
                    {serverCopy(active).serverStatus[state]}
                  </option>
                ))}
              </select>
              <select
                aria-label={copy.serverOrder}
                value={view.order}
                onChange={(event) =>
                  onView({ ...view, order: event.target.value as ListView['order'], page: 1 })
                }
              >
                <option value="name">{copy.orderByName}</option>
                <option value="last_checked">{copy.orderByLastCheck}</option>
              </select>
              <button
                className={`smp-server-header-icon${refreshing ? ' is-busy' : ''}`}
                type="button"
                aria-label={copy.retryConnections}
                title={copy.retryConnections}
                disabled={refreshing || rows.length === 0}
                onClick={() => {
                  void retryConnections()
                }}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M13 5.2A5.5 5.5 0 0 0 3.5 4M13 2.5v3.2h-3.2M3 10.8A5.5 5.5 0 0 0 12.5 12M3 13.5v-3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="primary" type="button" onClick={props.onCreate}>
                {copy.registerServer}
              </button>
            </div>
          }
        >
          {(actionError ?? loadError) !== null && (
            <p className="banner error" role="alert">
              {displayError(active, actionError ?? loadError)}
            </p>
          )}
          <div className="table-wrap smp-server-table-scroll" ref={tableScroll}>
            <table className="clickable smp-server-table" aria-label={copy.instances}>
              <thead>
                <tr>
                  <th>{copy.name}</th>
                  <th>{copy.address}</th>
                  <th>{copy.region}</th>
                  <th>{copy.operatingSystem}</th>
                  <th>{copy.serverType}</th>
                  <th>{copy.status}</th>
                  <th>{copy.resourceOverview}</th>
                  <th>{copy.lastCheck}</th>
                  <th>{copy.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((server) => (
                  <ServerLine
                    active={active}
                    key={server.id}
                    server={server}
                    onOpen={props.onOpen}
                    onTerminal={props.onTerminal}
                    onRemove={setRemoving}
                  />
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="smp-server-empty">
                {!loaded
                  ? loadError
                    ? copy.cannotLoadServers
                    : copy.loadingServers
                  : view.query.trim() !== '' || view.status !== ''
                    ? copy.noMatches
                    : groupId === null
                      ? copy.noServers
                      : copy.emptyGroup}
              </p>
            )}
          </div>
          <footer className="smp-server-pager" aria-label={copy.pagination}>
            <span>
              {format(total > 0 ? copy.range : copy.total, {
                count: total,
                from: (page - 1) * view.pageSize + 1,
                to: Math.min(page * view.pageSize, total),
              })}
            </span>
            <div className="row">
              <label>
                {copy.perPage}{' '}
                <select
                  aria-label={copy.pageSize}
                  value={view.pageSize}
                  onChange={(event) => {
                    onView({ ...view, pageSize: Number(event.target.value), page: 1 })
                  }}
                >
                  {[10, 20, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary"
                type="button"
                disabled={!loaded || page <= 1}
                onClick={() => {
                  onView({ ...view, page: page - 1 })
                }}
              >
                {copy.previous}
              </button>
              <span aria-live="polite">{format(copy.page, { page, pages })}</span>
              <button
                className="secondary"
                type="button"
                disabled={!loaded || page >= pages}
                onClick={() => {
                  onView({ ...view, page: page + 1 })
                }}
              >
                {copy.next}
              </button>
            </div>
          </footer>
        </Panel>
      </div>
      <Modal
        open={removing !== null}
        title={copy.removeServer}
        closeLabel={serverCopy(active).upgrades.close}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button disabled={removingBusy} onClick={() => setRemoving(null)}>
              {copy.cancel}
            </Button>
            <Button
              variant="danger"
              disabled={removingBusy}
              onClick={() => {
                if (removing === null) return
                setRemovingBusy(true)
                void removeServer(removing.id).then((ok) => {
                  setRemovingBusy(false)
                  if (ok) setRemoving(null)
                })
              }}
            >
              {copy.remove}
            </Button>
          </>
        }
      >
        <p>{format(copy.removeServerHint, { name: removing?.name ?? '' })}</p>
        {actionError !== null && <p className="banner error" role="alert">{displayError(active, actionError)}</p>}
      </Modal>
    </div>
  )
}
function GroupChoice(props: {
  active: string
  label: string
  count: number
  selected: boolean
  system?: boolean
  available?: boolean
  source?: string
  onSelect: () => void
  onDelete?: () => void
  renaming?: boolean
  renameValue?: string
  onRenameStart?: () => void
  onRenameChange?: (value: string) => void
  onRenameCancel?: () => void
  onRenameSave?: () => void
}) {
  const copy = serverCopy(props.active).ui
  if (props.renaming)
    return (
      <form
        className="smp-server-group smp-server-group-rename"
        onSubmit={(event) => {
          event.preventDefault()
          props.onRenameSave?.()
        }}
      >
        <input
          aria-label={copy.groupName}
          value={props.renameValue ?? ''}
          maxLength={80}
          autoFocus
          onChange={(event) => props.onRenameChange?.(event.target.value)}
        />
        <button
          className="smp-server-group-icon-button"
          type="submit"
          aria-label={copy.save}
          title={copy.save}
          disabled={(props.renameValue ?? '').trim() === ''}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="m3.2 8.2 3.1 3.1 6.5-6.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="smp-server-group-icon-button"
          type="button"
          aria-label={copy.cancel}
          title={copy.cancel}
          onClick={props.onRenameCancel}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </form>
    )
  return (
    <div className={`smp-server-group${props.selected ? ' is-on' : ''}`}>
      <button
        className="smp-server-group-choice"
        type="button"
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}
        title={props.source === undefined ? props.label : `${props.label} (${props.source})`}
      >
        <span>
          {props.label}
          {props.system && props.available === false && (
            <small className="smp-server-group-source">{copy.pluginUnavailable}</small>
          )}
        </span>
        <span className="smp-server-group-count">{props.count}</span>
      </button>
      {props.onRenameStart && (
        <button
          className="smp-server-group-rename-button"
          type="button"
          aria-label={format(copy.renameGroupNamed, { name: props.label })}
          title={copy.renameGroup}
          onClick={props.onRenameStart}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M10.5 2.8 13.2 5.5 6 12.7l-3.2.7.7-3.2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {props.onDelete && (
        <button
          className="smp-server-group-delete"
          type="button"
          aria-label={format(copy.deleteNamedGroup, { name: props.label })}
          title={copy.deleteGroup}
          onClick={props.onDelete}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3 4.5h10M6 4.5V2.8h4v1.7M4.5 4.5l.6 9h5.8l.6-9M6.5 7v4M9.5 7v4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
