import { enumLabel, serverCopy, statusReason } from '../../../shared/i18n.ts'
import { type DisplayStatus } from '../../../shared/server-status.ts'
export function ServerStatus({ active, status }: { active: string; status: DisplayStatus }) {
  return (
    <span
      className={`pill smp-server-status ${status.code}`}
      title={status.reasons.map((reason) => statusReason(active, reason)).join('\n')}
    >
      {serverCopy(active).serverStatus[status.code]}
    </span>
  )
}

export function SoftwareState(props: { active: string; state: string }) {
  const copy = serverCopy(props.active).ui
  const labels: Record<string, string> = {
    ready: copy.softwareReady,
    pending: copy.softwarePending,
    unknown: copy.softwareUnknown,
    unavailable: copy.softwareUnavailable,
  }
  return (
    <span
      className={`pill ${props.state === 'ready' ? 'online' : props.state === 'pending' ? 'queued' : 'unknown'}`}
    >
      {enumLabel(labels, props.state)}
    </span>
  )
}
