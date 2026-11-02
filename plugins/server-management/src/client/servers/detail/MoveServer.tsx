import { useEffect, useState } from 'react'
import {
  defaultTypeForOs,
  type SoftwareView,
  type TypeOptions,
  typeSupportsOs,
} from '../../../shared/definitions.ts'
import { type GroupView } from '../../../shared/dto/groups.ts'
import { displayError, groupName, localized, serverCopy } from '../../../shared/i18n.ts'
import type { DeclaredOs } from '../../../shared/operating-systems.ts'
import type { SoftwarePolicy } from '../../../shared/policies.ts'
import { ChangePlan } from '../../changes/ChangePlan.tsx'
import { api, requestError } from '../../shared/api.ts'
import { Dialog as Modal, DialogButton as Button } from '@smp/console-kit/dialog'
import { SoftwarePolicies } from '../components/SoftwarePolicies.tsx'
export function MoveServer(props: {
  active: string
  server: {
    id: string
    group_id: string | null
    type_key: string
    declared_os: DeclaredOs
    software_policies: SoftwarePolicy[]
  }
  onClose: () => void
}) {
  const { active, server } = props,
    c = serverCopy(active).upgrades,
    ui = serverCopy(active).ui
  const [groups, setGroups] = useState<GroupView[]>([]),
    [defaults, setDefaults] = useState<TypeOptions>(),
    [group, setGroup] = useState(server.group_id ?? ''),
    [type, setType] = useState(server.type_key)
  const [policies, setPolicies] = useState(server.software_policies),
    [install, setInstall] = useState(false),
    [plan, setPlan] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let stopped = false
    void Promise.all([
      api<GroupView[]>('/console-api/server-groups'),
      api<TypeOptions>('/console-api/server-types'),
    ])
      .then(([groups, defaults]) => {
        if (!stopped) {
          setGroups(groups)
          setDefaults(defaults)
        }
      })
      .catch((cause) => {
        if (!stopped) setError(displayError(active, requestError(cause)))
      })
    return () => {
      stopped = true
    }
  }, [active])
  const choices = group ? groups.find((g) => g.id === group) : defaults,
    types = choices?.types.filter((t) => typeSupportsOs(t, server.declared_os)) ?? [],
    selected = types.find((t) => t.key === type)
  const software: readonly SoftwareView[] = selected?.software ?? []
  function changeGroup(next: string) {
    const options = next ? groups.find((g) => g.id === next) : defaults,
      allowed = options?.types.filter((t) => typeSupportsOs(t, server.declared_os)) ?? []
    setGroup(next)
    setType(
      allowed.some((t) => t.key === type)
        ? type
        : (allowed.find((t) => t.key === defaultTypeForOs(options, server.declared_os))?.key ?? ''),
    )
  }
  async function preflight() {
    setBusy(true)
    setError('')
    try {
      const p = await api<{ id: string }>('/console-api/server-changes/plans', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'move',
          server_ids: [server.id],
          group_id: group || null,
          type_key: type,
          install_missing: install,
          software_policies: software.map(
            (s) =>
              policies.find((p) => p.software_key === s.software_key) ?? {
                software_key: s.software_key,
                restriction: { kind: 'any' },
                detect_updates: false,
              },
          ),
        }),
      })
      setPlan(p.id)
    } catch (cause) {
      setError(displayError(active, requestError(cause)))
    } finally {
      setBusy(false)
    }
  }
  if (plan !== '') {
    return (
      <ChangePlan key={plan} dialog active={active} id={plan} onNewPlan={setPlan} onClose={props.onClose} />
    )
  }
  return (
    <Modal
      open
      title={c.moveServer}
      closeLabel={c.close}
      onClose={props.onClose}
      className="smp-dialog-wide smp-dialog-move"
      footer={
        <>
          <Button onClick={props.onClose}>{c.close}</Button>
          <Button
            variant="primary"
            disabled={busy || !selected || !choices?.available}
            onClick={() => void preflight()}
          >
            {c.preflight}
          </Button>
        </>
      }
    >
      <p>{c.moveHint}</p>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <div className="smp-upgrade-fields">
        <label className="field">
          {c.destination}
          <select value={group} onChange={(e) => changeGroup(e.target.value)}>
            <option value="">{ui.ungrouped}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.available}>
                {groupName(active, g)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {c.targetType}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {!selected && <option value="">{ui.osChoose}</option>}
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {localized(t.name_i18n, active)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SoftwarePolicies
        active={active}
        software={software}
        value={policies.filter((p) => software.some((s) => s.software_key === p.software_key))}
        onChange={setPolicies}
      />
      <label className="smp-upgrade-ack">
        <input
          type="checkbox"
          checked={install}
          disabled={!software.length}
          onChange={(e) => setInstall(e.target.checked)}
        />
        {c.installMissing}
      </label>
    </Modal>
  )
}
