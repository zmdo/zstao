import { useState } from 'react'
import { format, formatDate, localized, serverCopy } from '../../../shared/i18n.ts'
import { type ServerListItem } from '../../../shared/dto/servers.ts'
import { bytes, ratio } from '../../shared/resources.ts'
import { ServerStatus } from '../components/ServerStatus.tsx'
export function ServerLine(props: {
  active: string
  server: ServerListItem
  onOpen: (id: string) => void
  onTerminal: (id: string) => void
  onRemove: (server: ServerListItem) => void
}) {
  const { server, active } = props
  const copy = serverCopy(active).ui
  const resources = server.resources
  return (
    <tr onClick={() => props.onOpen(server.id)}>
      <td>
        <button
          className="smp-server-open"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            props.onOpen(server.id)
          }}
        >
          {server.name}
        </button>
      </td>
      <td className="smp-server-address-cell">
        <AddressLine active={active} label={copy.externalAddress} value={server.address.host} />
        <AddressLine active={active} label={copy.internalAddress} value={server.internal_host} />
      </td>
      <td>{server.region || '—'}</td>
      <td>{server.operatingSystem.label}</td>
      <td title={server.type.available ? undefined : copy.typeUnavailable}>
        {localized(server.type.name, active)}
      </td>
      <td>
        <ServerStatus active={active} status={server.status} />
      </td>
      <td
        className="smp-server-resources"
        title={
          resources.sampledAt
            ? format(copy.resourceSampledAt, { time: formatDate(resources.sampledAt, active) })
            : copy.resourcesUnknown
        }
      >
        <ResourceLine
          kind="cpu"
          percent={resources.fresh ? resources.cpuPercent : null}
          text={
            resources.fresh
              ? `${resources.cpuModel ?? 'CPU'}${resources.cpuCores === null ? '' : `*${resources.cpuCores}`} (${resources.cpuPercent === null ? '—' : Math.round(resources.cpuPercent)}%)`
              : '—'
          }
        />
        <ResourceLine
          kind="memory"
          percent={resources.fresh ? ratio(resources.memoryUsed, resources.memoryTotal) : null}
          text={resourceLine(copy.memory, resources.memoryUsed, resources.memoryTotal, resources.fresh)}
        />
        <ResourceLine
          kind="disk"
          percent={resources.fresh ? ratio(resources.diskUsed, resources.diskTotal) : null}
          text={resourceLine(copy.disk, resources.diskUsed, resources.diskTotal, resources.fresh)}
        />
        {resources.sampledAt && !resources.fresh && <small className="muted">{copy.resourcesStale}</small>}
      </td>
      <td>{formatDate(server.lastCheckedAt, active)}</td>
      <td className="smp-server-actions">
        <button
          className="smp-server-action-icon"
          type="button"
          aria-label={copy.details}
          title={copy.details}
          onClick={(event) => {
            event.stopPropagation()
            props.onOpen(server.id)
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4S1.8 8 1.8 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
        <button
          className="smp-server-action-icon"
          type="button"
          aria-label={copy.terminal}
          title={copy.terminal}
          onClick={(event) => {
            event.stopPropagation()
            props.onTerminal(server.id)
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="m3 5 3 3-3 3M8.5 11H13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="smp-server-action-icon danger"
          type="button"
          aria-label={copy.remove}
          title={copy.remove}
          onClick={(event) => {
            event.stopPropagation()
            props.onRemove(server)
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M3 4.5h10M6 4.5V2.8h4v1.7M4.5 4.5l.6 9h5.8l.6-9M6.5 7v4M9.5 7v4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

function AddressLine(props: { active: string; label: string; value: string | null }) {
  const copy = serverCopy(props.active).ui
  const [copied, setCopied] = useState(false)
  const value = props.value ?? ''
  return (
    <span className="smp-address-row">
      <small>{props.label}</small>
      <span className="mono">{value || '—'}</span>
      {value !== '' && (
        <button
          className="smp-copy-address"
          type="button"
          aria-label={copied ? copy.copied : copy.copyAddress}
          title={copied ? copy.copied : copy.copyAddress}
          onClick={(event) => {
            event.stopPropagation()
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2h7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  )
}

function resourceLine(label: string, used: string | null, total: string | null, fresh: boolean): string {
  if (!fresh || used === null || total === null) return `${label} —`
  const ratioValue = ratio(used, total)
  return `${label} ${bytes(used)}/${bytes(total)} (${ratioValue === null ? '—' : Math.round(ratioValue)}%)`
}

function ResourceLine(props: { kind: 'cpu' | 'memory' | 'disk'; percent: number | null; text: string }) {
  const value = props.percent === null ? 0 : Math.max(0, Math.min(100, props.percent))
  const tone = props.percent !== null && value > 80 ? 'hot' : props.kind
  return (
    <span className="smp-resource-line">
      <span className="smp-resource-track" aria-hidden="true">
        <i className={tone} style={{ width: `${value}%` }} />
      </span>
      <span className="smp-resource-text">{props.text}</span>
      <span
        aria-hidden="true"
        className="smp-resource-text is-filled"
        style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
      >
        {props.text}
      </span>
    </span>
  )
}
