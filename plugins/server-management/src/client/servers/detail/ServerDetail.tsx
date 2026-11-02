import { Panel } from '@smp/console-kit'
import type { ServerDto } from '../../../shared/dto/servers.ts'
import type { ServerError } from '../../../shared/errors.ts'
import {
  displayError,
  enumLabel,
  formatDate,
  localized,
  serverCopy,
  statusReason,
} from '../../../shared/i18n.ts'
import { osLabel } from '../../../shared/operating-systems.ts'
import { bytes, ratio } from '../../shared/resources.ts'
import { RequiredSoftware } from '../components/RequiredSoftware.tsx'
import { ResourceHistory } from './ResourceHistory.tsx'
import { SoftwareState } from '../components/ServerStatus.tsx'

export interface ServerDetailProps {
  active: string
  server: ServerDto
  error: ServerError | null
  queued: boolean
  onTerminal: () => void
  onUpgrades: () => void
  onTest: () => void
  onInspect: () => void
  onInstall: () => void
}

export function ServerDetail(props: ServerDetailProps) {
  const { active, server, error, queued } = props
  const copy = serverCopy(active).ui
  const missing =
    server.type_available && server.required_software.length > 0 && server.software_state !== 'ready'
  const group = server.group_name_i18n
    ? localized(server.group_name_i18n, active)
    : server.group_name || copy.ungrouped

  return (
    <Panel>
      {error !== null ? <p className="banner error">{displayError(active, error)}</p> : null}
      {queued ? <p className="banner ok">{copy.jobQueued}</p> : null}
      {!server.type_available && <p className="banner error">{copy.typeUnavailable}</p>}
      {server.os_verification === 'custom' && <p className="banner">{copy.osCustomVerification}</p>}
      {server.os_verification !== 'matched' && server.os_verification !== 'custom' && (
        <p className={`banner ${server.os_verification === 'mismatch' ? 'error' : ''}`}>
          {server.os_verification === 'mismatch' ? copy.osMismatch : copy.osUnverified}
        </p>
      )}
      <div className="node-card smp-card">
        {server.status.reasons.length > 0 && (
          <ul className="smp-server-status-reasons">
            {server.status.reasons.map((reason, index) => (
              <li key={index}>{statusReason(active, reason)}</li>
            ))}
          </ul>
        )}
        <div className="node-grid">
          <div>
            <span>{copy.connectionStatus}</span>
            {enumLabel(serverCopy(active).reach, server.reachability)}
          </div>
          <div>
            <span>{copy.user}</span>
            {server.ssh_user}
          </div>
          <div>
            <span>{copy.region}</span>
            {server.region || '—'}
          </div>
          <div>
            <span>{copy.group}</span>
            {group}
          </div>
          <div>
            <span>{copy.operatingSystem}</span>
            {osLabel(server.declared_os)}
          </div>
          <div>
            <span>{copy.osDetected}</span>
            {server.detected_os
              ? `${server.detected_os.family.replace('builtin/', '')} ${server.detected_os.version} · ${server.detected_os.architecture}`
              : copy.osUnverified}
          </div>
          <div>
            <span>{copy.serverType}</span>
            {localized(server.type_name_i18n, active)}
          </div>
          <div>
            <span>{copy.requiredSoftware}</span>
            <SoftwareState active={active} state={server.software_state} />
          </div>
          <div>
            <span>{copy.lastCheck}</span>
            {formatDate(server.last_checked_at, active)}
          </div>
          <Usage
            label="CPU"
            text={`${server.cpu_model ?? 'CPU'}${server.cpu_cores === null ? '' : `*${server.cpu_cores}`} (${server.cpu_percent === null ? '—' : Math.round(Number(server.cpu_percent))}%)`}
            percent={server.cpu_percent === null ? null : Number(server.cpu_percent)}
          />
          <Usage
            label={copy.memory}
            text={usageText(server.mem_used_bytes, server.mem_total_bytes)}
            percent={ratio(server.mem_used_bytes, server.mem_total_bytes)}
          />
          <Usage
            label={copy.disk}
            text={usageText(server.disk_used_bytes, server.disk_total_bytes)}
            percent={ratio(server.disk_used_bytes, server.disk_total_bytes)}
          />
        </div>
        <div className="smp-server-fingerprint">
          <span>{copy.hostFingerprint}</span>
          <b className="mono">{server.host_fingerprint || copy.notPinned}</b>
        </div>
        <div className="node-actions">
          <button className="secondary" type="button" onClick={props.onUpgrades}>
            {serverCopy(active).upgrades.openUpgrades} ({server.upgrade_count})
          </button>
          <button className="secondary" type="button" onClick={props.onTest}>
            {copy.testConnection}
          </button>
          <button className="secondary" type="button" onClick={props.onInspect}>
            {copy.refresh}
          </button>
          {missing ? (
            <button className="secondary" type="button" onClick={props.onInstall}>
              {copy.installComponents}
            </button>
          ) : null}
          <button className="secondary" type="button" onClick={props.onTerminal}>
            {copy.terminal}
          </button>
        </div>
      </div>
      <ResourceHistory active={active} serverId={server.id} createdAt={server.created_at} />
      <RequiredSoftware active={active} software={server.required_software} status={server.software_status} />
    </Panel>
  )
}

function usageText(used: string | null, total: string | null): string {
  const percent = ratio(used, total)
  return `${bytes(used)}/${bytes(total)} (${percent === null ? '—' : Math.round(percent)}%)`
}

function Usage(props: { label: string; text: string; percent: number | null }) {
  const value = props.percent === null ? 0 : Math.max(0, Math.min(100, props.percent))
  const level = props.percent === null ? 'unknown' : value >= 85 ? 'hot' : value >= 60 ? 'warn' : 'ok'
  return (
    <div className="smp-server-usage">
      <span>{props.label}</span>
      <b>{props.text}</b>
      <div className="smp-server-usage-bar">
        <i className={level} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}
