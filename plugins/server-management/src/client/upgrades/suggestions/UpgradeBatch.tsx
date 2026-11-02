import type { UpgradeSuggestionsModel } from './useUpgradeSuggestions.ts'

export function UpgradeBatch(props: { model: UpgradeSuggestionsModel }) {
  const {
    batchSoftware,
    busy,
    c,
    chosen,
    commands,
    keys,
    selected,
    setBatchSoftware,
    setChosen,
    softwareName,
    versions,
  } = props.model
  return (
    <>
      {selected.length > 0 && (
        <section className="smp-plan-confirm">
          <h3>{c.selectSoftware}</h3>
          <div className="row">
            {[...new Set([...keys, ...batchSoftware])].map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={batchSoftware.includes(key)}
                  onChange={(e) =>
                    setBatchSoftware((old) =>
                      e.target.checked ? [...old, key] : old.filter((s) => s !== key),
                    )
                  }
                />
                {softwareName(key)}
              </label>
            ))}
          </div>
          {batchSoftware.map((key) => (
            <label className="field" key={key}>
              {softwareName(key)} · {c.chooseVersion}
              <select
                value={chosen[key] ?? ''}
                onChange={(e) => setChosen((old) => ({ ...old, [key]: e.target.value }))}
              >
                <option value="">{c.chooseVersion}</option>
                {(versions[key] ?? []).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              {!versions[key]?.length && <span className="banner error">{c.noCommon}</span>}
            </label>
          ))}
          <button
            className="primary"
            disabled={busy || !batchSoftware.length || batchSoftware.some((key) => !chosen[key])}
            onClick={() => void commands.createPlan()}
          >
            {c.createPlan}
          </button>
        </section>
      )}
    </>
  )
}
