import type { SoftwareView } from '../../../shared/definitions.ts'
import { TableCard } from '@smp/console-kit'
import { localized, serverCopy, versionRequirement } from '../../../shared/i18n.ts'
import type { SoftwarePolicy } from '../../../shared/policies.ts'
import type { VersionRule } from '../../../shared/versions.ts'
export function SoftwarePolicies(props: {
  active: string
  software: readonly SoftwareView[]
  value: SoftwarePolicy[]
  onChange: (policies: SoftwarePolicy[]) => void
  installed?: Record<string, { version?: string }>
}) {
  const { active, software, value } = props,
    c = serverCopy(active).upgrades
  if (!software.length) return null
  function change(key: string, values: Partial<SoftwarePolicy>) {
    props.onChange(
      software.map((s) => ({
        ...(value.find((p) => p.software_key === s.software_key) ?? {
          software_key: s.software_key,
          restriction: { kind: 'any' },
          detect_updates: false,
        }),
        ...(s.software_key === key ? values : {}),
      })),
    )
  }
  return (
    <>
    <TableCard title={c.policies} ariaLabel={c.policies}>
      <div className="smp-upgrade-scroll">
        <table className="smp-table">
          <thead>
            <tr>
              <th>{c.software}</th>
              <th>{c.allowed}</th>
              <th>{c.restriction}</th>
              <th>{c.detectUpdates}</th>
            </tr>
          </thead>
          <tbody>
            {software.map((s) => {
              const p = value.find((p) => p.software_key === s.software_key) ?? {
                  software_key: s.software_key,
                  restriction: { kind: 'any' } as const,
                  detect_updates: false,
                },
                rule = p.restriction
              const version = props.installed?.[s.id]?.version
              const effective = rule.kind === 'any' ? s.versions : rule
              const fixed = effective?.kind === 'exact',
                ceiling = effective?.kind === 'range' && effective.maximum === version
              return (
                <tr key={s.software_key}>
                  <td>{localized(s.name_i18n, active)}</td>
                  <td>{versionRequirement(active, s.versions)}</td>
                  <td>
                    <div className="smp-rule-editor">
                      <select
                        aria-label={`${localized(s.name_i18n, active)} ${c.restriction}`}
                        value={rule.kind}
                        onChange={(e) => {
                          const kind = e.target.value as VersionRule['kind']
                          const next: VersionRule =
                            kind === 'any'
                              ? { kind }
                              : kind === 'series'
                                ? { kind, prefix: '' }
                                : kind === 'range'
                                  ? { kind, minimum: '', maximum: '' }
                                  : { kind, version: '' }
                          change(s.software_key, { restriction: next })
                        }}
                      >
                        {(['any', 'exact', 'series', 'minimum', 'range'] as const).map((kind) => (
                          <option key={kind} value={kind}>
                            {kind === 'any' ? c.inherit : c[kind]}
                          </option>
                        ))}
                      </select>
                      {rule.kind === 'series' ? (
                        <input
                          aria-label={c.version}
                          placeholder="27.3"
                          value={rule.prefix}
                          onChange={(e) =>
                            change(s.software_key, { restriction: { ...rule, prefix: e.target.value } })
                          }
                        />
                      ) : rule.kind === 'range' ? (
                        <>
                          <input
                            aria-label={c.minimumVersion}
                            placeholder="27.1"
                            value={rule.minimum}
                            onChange={(e) =>
                              change(s.software_key, { restriction: { ...rule, minimum: e.target.value } })
                            }
                          />
                          <span>–</span>
                          <input
                            aria-label={c.maximumVersion}
                            placeholder="27.3"
                            value={rule.maximum}
                            onChange={(e) =>
                              change(s.software_key, { restriction: { ...rule, maximum: e.target.value } })
                            }
                          />
                        </>
                      ) : rule.kind !== 'any' ? (
                        <input
                          aria-label={c.version}
                          placeholder={rule.kind === 'exact' ? '27.3.1' : '27'}
                          value={rule.version}
                          onChange={(e) =>
                            change(s.software_key, { restriction: { ...rule, version: e.target.value } })
                          }
                        />
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`${localized(s.name_i18n, active)} ${c.detectUpdates}`}
                        checked={p.detect_updates}
                        disabled={fixed || ceiling}
                        onChange={(e) => change(s.software_key, { detect_updates: e.target.checked })}
                      />
                      {fixed ? (
                        <small>{c.fixed_version}</small>
                      ) : ceiling ? (
                        <small>{c.range_ceiling}</small>
                      ) : null}
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </TableCard>
    <p className="smp-section-hint">{c.policyHint}</p>
    </>
  )
}
