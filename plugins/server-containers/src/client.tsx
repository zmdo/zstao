import { useEffect, useState } from 'react'
import { registerServerPanel, registerSettingsSection, type ExtensionSlotOwner, type SlotService } from '@smp/console-server-management/client-api'
import type { ContainerSnapshot } from './model.ts'
import { pollSnapshots } from './poll.ts'
import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import css from './style.css'

const owner = '@smp/console-server-containers'
const copyFor = (active: string) => (active === 'zh' ? zh : en).ui
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))

function ContainersPanel(props: ExtensionSlotOwner) {
  const copy = copyFor(props.active)
  const server = props.server
  const docker = server.software_status[`${owner}/docker-engine`]
  const [snapshot, setSnapshot] = useState<ContainerSnapshot>()
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  useEffect(() => {
    setSnapshot(undefined)
    setPage(1)
  }, [server.id])
  useEffect(() => {
    setLoading(true)
    return pollSnapshots({
      read: async (signal) => await props.api.data(server.id, `${owner}/container-list`, {}, signal) as ContainerSnapshot,
      publish: (value) => { setSnapshot(value); setLoading(false); setError(false) },
      failed: () => { setLoading(false); setError(true) },
      intervalMs: 10_000,
    })
  }, [props.api, server.id, refresh])
  const containers = snapshot?.rows ?? []
  const pages = Math.max(1, Math.ceil(containers.length / pageSize))
  const current = Math.min(page, pages)
  const visible = containers.slice((current - 1) * pageSize, current * pageSize)
  const stale = error || snapshot?.status === 'failed'
  return (
    <section className="panel smp-container-panel">
      <style>{css}</style>
      <div className="smp-container-toolbar smp-task-top">
        <span className="muted">{copy.lastSuccess}: {snapshot?.last_success_at ?? copy.never}</span>
        <button className="secondary" type="button" disabled={loading} onClick={() => { setPage(1); setRefresh((n) => n + 1) }}>{copy.refresh}</button>
      </div>
      {(docker !== undefined && docker.state !== 'installed') || error || snapshot?.status === 'failed' || (stale && snapshot?.last_success_at) ? (
        <div className="smp-container-status">
          {docker !== undefined && docker.state !== 'installed' && <p className="error">{docker.detail || copy.dockerUnavailable}</p>}
          {error && <p className="banner error">{copy.loadFailed}</p>}
          {snapshot?.status === 'failed' && <p className="banner error">{copy.inspectFailed} {snapshot.error?.params?.detail}</p>}
          {stale && snapshot?.last_success_at && <p className="muted">{copy.stale}</p>}
        </div>
      ) : null}
      <div className="panel-body">
        {loading && !snapshot ? <p className="container-empty">{copy.loading}</p> : !snapshot?.last_success_at ? (
          !error && <p className="container-empty">{copy.noObservation}</p>
        ) : containers.length === 0 ? <p className="container-empty">{copy.noContainers}</p> : (
          <div className="table-scroll"><table className="smp-table">
            <thead><tr><th>{copy.name}</th><th>{copy.image}</th><th>{copy.status}</th><th>{copy.ports}</th></tr></thead>
            <tbody>{visible.map((item) => <tr key={item.container_id}>
              <td>{item.name}</td><td>{item.image}</td><td>{item.status}</td><td>{item.ports}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
      {snapshot?.last_success_at && (
        <footer className="smp-server-pager smp-container-pager smp-task-pager">
          <span>{fill(copy.range, { count: containers.length, from: (current - 1) * pageSize + 1, to: Math.min(current * pageSize, containers.length) })}</span>
          <div className="row">
            <label>
              {copy.perPage}
              <select aria-label={copy.perPage} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}>
                {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button className="secondary" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>{copy.previous}</button>
            <span>{fill(copy.pageOf, { page: current, pages })}</span>
            <button className="secondary" type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>{copy.next}</button>
          </div>
        </footer>
      )}
    </section>
  )
}

function ContainerSettings(props: ExtensionSlotOwner) {
  const value = (props.settings?.value ?? {}) as { collect?: boolean }
  return <label className="smp-server-auto-install">
    <input type="checkbox" checked={value.collect !== false} disabled={props.settings?.saving}
      onChange={(event) => props.settings?.onChange({ collect: event.target.checked })} />{' '}
    {copyFor(props.active).collect}
  </label>
}

export const inject = ['slots']
export function apply(ctx: { slots: SlotService }): void {
  registerServerPanel(ctx, `${owner}/containers`, ContainersPanel)
  registerSettingsSection(ctx, `${owner}/container-settings`, ContainerSettings)
}
