import { TableCard } from '@smp/console-kit'
import type { ServerDto } from '../../../shared/dto/servers.ts'
import { type SoftwareView } from '../../../shared/definitions.ts'
import { componentText, format, serverCopy, versionRequirement } from '../../../shared/i18n.ts'
export function RequiredSoftware(props: {
  active: string
  software: readonly SoftwareView[]
  status?: ServerDto['software_status']
}) {
  const copy = serverCopy(props.active).ui
  return (
    <TableCard title={copy.requiredSoftware} ariaLabel={copy.requiredSoftware}>

      {props.software.length === 0 ? (
        <p className="muted">{copy.noRequiredSoftware}</p>
      ) : (
        <div className="table-wrap">
          <table className="smp-table">
            <thead>
              <tr>
                <th>{copy.softwareName}</th>
                <th>{copy.versionRequirement}</th>
                <th>{copy.installedVersion}</th>
                <th>{copy.status}</th>
              </tr>
            </thead>
            <tbody>
              {props.software.map((component) => {
                const item = props.status?.[component.id]
                const state = item?.state ?? (item?.installed === true ? 'installed' : 'unknown')
                const status =
                  state === 'installed'
                    ? copy.installed
                    : state === 'missing'
                      ? copy.notInstalled
                      : item?.detail
                        ? copy.softwareDetectionFailed
                        : copy.softwareNotChecked
                const text = componentText(props.active, component)
                return (
                  <tr key={component.id}>
                    <td>
                      <strong>{text.name}</strong>
                      {text.summary && <small className="muted">{text.summary}</small>}
                    </td>
                    <td>{versionRequirement(props.active, component.versions)}</td>
                    <td className="smp-software-version">
                      {state === 'installed' ? item?.version || '—' : '—'}
                      {state === 'unknown' && item?.last_known_version && (
                        <small className="muted">
                          {format(copy.lastKnownVersion, { version: item.last_known_version })}
                        </small>
                      )}
                    </td>
                    <td>
                      {status}
                      {item?.detail && <small className="muted">{item.detail}</small>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  )
}
