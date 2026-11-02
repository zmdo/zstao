import { enumLabel, groupName, localized } from '../../../shared/i18n.ts'
import type { UpgradeSuggestionsModel } from './useUpgradeSuggestions.ts'

export function SuggestionFilters(props: { model: UpgradeSuggestionsModel }) {
  const {
    active,
    c,
    connection,
    current,
    decision,
    group,
    groups,
    inventory,
    q,
    setConnection,
    setCurrent,
    setDecision,
    setGroup,
    setPage,
    setQ,
    setSoftware,
    setTarget,
    setType,
    software,
    softwareName,
    target,
    type,
  } = props.model
  return (
    <>
      <div className="smp-upgrade-filter-region">
        <div className="smp-upgrade-fields smp-upgrade-filters" role="group" aria-label={c.filters}>
          <label className="field">
            {c.search}
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </label>
          <label className="field">
            {c.group}
            <select
              value={group}
              onChange={(e) => {
                setGroup(e.target.value)
                setPage(1)
              }}
            >
              <option value="">{c.all}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {groupName(active, g)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {c.type}
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                setPage(1)
              }}
            >
              <option value="">{c.all}</option>
              {[...new Set(inventory.map((s) => s.type_key))].map((key) => (
                <option key={key} value={key}>
                  {localized(inventory.find((s) => s.type_key === key)!.type_name_i18n, active)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {c.software}
            <select
              value={software}
              onChange={(e) => {
                setSoftware(e.target.value)
                setPage(1)
              }}
            >
              <option value="">{c.all}</option>
              {[
                ...new Set(
                  inventory.flatMap((s) => (s.required_software ?? []).map((item) => item.software_key)),
                ),
              ].map((key) => (
                <option key={key} value={key}>
                  {softwareName(key)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {c.current}
            <input
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value)
                setPage(1)
              }}
            />
          </label>
          <label className="field">
            {c.target}
            <input
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
                setPage(1)
              }}
            />
          </label>
          <label className="field">
            {c.connection}
            <select
              value={connection}
              onChange={(e) => {
                setConnection(e.target.value)
                setPage(1)
              }}
            >
              <option value="">{c.all}</option>
              {['online', 'offline', 'unknown'].map((s) => (
                <option key={s} value={s}>
                  {enumLabel(c, s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {c.decision}
            <select
              value={decision}
              onChange={(e) => {
                setDecision(e.target.value)
                setPage(1)
              }}
            >
              {['pending', 'all', 'deferred', 'rejected', 'scheduled', 'detection_failed'].map((s) => (
                <option key={s} value={s}>
                  {enumLabel(c, s)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </>
  )
}
