import { format, formatDate, localized, serverCopy } from '../../../shared/i18n.ts'
import { OS_CATALOG } from '../../../shared/operating-systems.ts'
import { RequiredSoftware } from '../components/RequiredSoftware.tsx'
import { SoftwarePolicies } from '../components/SoftwarePolicies.tsx'
import type { ServerFormModel } from './useServerForm.ts'
export function SystemFields(props: { form: ServerFormModel; editing: boolean; showPolicies?: boolean; showRequiredSoftware?: boolean }) {
  const {
    active,
    applicableTypes,
    architecture,
    auto,
    available,
    busy,
    cachedIdentification,
    choices,
    configuredSoftware,
    copy,
    currentConnection,
    declaredOs,
    family,
    groupId,
    identified,
    identify,
    osFamily,
    osRelease,
    osText,
    pending,
    policies,
    queueIdentification,
    savedOs,
    selected,
    setAuto,
    setOsFamily,
    setOsRelease,
    setOsText,
    setPolicies,
    setTypeKey,
    software,
    softwareStatus,
    typeKey,
  } = props.form
  return (
    <section className="smp-server-form-section smp-card" aria-label={copy.systemInfo}>
      <h2>{copy.systemInfo}</h2>
      <div className="smp-server-form-section-body">
        <label className="field">
          {copy.operatingSystem}
          <select
            value={osFamily}
            required
            onChange={(event) => {
              setOsFamily(event.target.value)
              setOsRelease('')
              setOsText('')
              if (!props.editing) {
                setTypeKey('')
                setAuto(false)
              }
            }}
          >
            <option value="">{copy.osChoose}</option>
            {OS_CATALOG.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
            <option value="custom">{copy.osOther}</option>
          </select>
        </label>
        {osFamily === 'custom' ? (
          <label className="field">
            {copy.osCustom}
            <input
              value={osText}
              required
              maxLength={200}
              placeholder="openSUSE Leap 15.6"
              onChange={(event) => setOsText(event.target.value)}
            />
          </label>
        ) : (
          <label className="field">
            {copy.osRelease}
            <select
              value={osRelease}
              required
              disabled={family === undefined}
              onChange={(event) => {
                setOsRelease(event.target.value)
                if (!props.editing) {
                  setTypeKey('')
                  setAuto(false)
                }
              }}
            >
              <option value="">{copy.osChoose}</option>
              {savedOs?.kind === 'catalog' &&
                savedOs.family === osFamily &&
                !family?.releases.some((item) => item.key === savedOs.releaseKey) && (
                  <option value={savedOs.releaseKey}>{savedOs.name}</option>
                )}
              {family?.releases.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          {copy.serverType}
          <select
            value={typeKey}
            onChange={(event) => {
              queueIdentification(groupId, event.target.value)
              setTypeKey(event.target.value)
              setAuto(false)
            }}
            disabled={props.editing || !choices?.available || declaredOs === undefined}
          >
            {selected !== undefined && !applicableTypes.some((type) => type.key === typeKey) && (
              <option value={typeKey} disabled>
                {localized(selected.name_i18n, active)} ({copy.typeUnavailable})
              </option>
            )}
            {typeKey === '' && <option value="">{copy.osChoose}</option>}
            {applicableTypes.map((type) => (
              <option key={type.key} value={type.key}>
                {localized(type.name_i18n, active)}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{copy.osNote}</p>
        {declaredOs !== undefined && applicableTypes.length === 0 && (
          <p className="banner error">{copy.osNoTypes}</p>
        )}
        {declaredOs !== undefined && choices !== undefined && !available && (
          <p className="muted">
            {choices.available ? serverCopy(active).errors.os_type_unsupported : copy.typeUnavailable}
          </p>
        )}
        {props.editing && <p className="muted">{serverCopy(active).upgrades.moveEditing}</p>}
        {architecture && (
          <p className="muted">
            {copy.architecture}: {architecture}
          </p>
        )}
        {identified && (
          <p className="muted">
            {format(copy.systemIdentified, { time: formatDate(identified.detected_at, active) })}
            {cachedIdentification && ` ${copy.cachedSystemInformation}`}
          </p>
        )}
        {identified && !identified.software_available && <p className="muted">{copy.typeUnavailable}</p>}
        {props.showRequiredSoftware !== false && (
          <RequiredSoftware active={active} software={software} status={softwareStatus} />
        )}
        {props.showPolicies !== false && (
          <>
            <SoftwarePolicies
              active={active}
              software={configuredSoftware}
              value={policies}
              onChange={setPolicies}
              installed={softwareStatus}
            />
            <label className="smp-server-auto-install">
              <input
                type="checkbox"
                checked={software.length > 0 && auto}
                disabled={software.length === 0 || !available}
                onChange={(event) => {
                  setAuto(event.target.checked)
                }}
              />{' '}
              {copy.autoInstall}
            </label>
          </>
        )}
        <p className="muted">{copy.manualSystemNote}</p>
      </div>
      <footer>
        <button
          className="secondary smp-server-identify"
          type="button"
          disabled={!currentConnection || pending !== null || busy}
          onClick={() => {
            void identify()
          }}
        >
          {pending === 'identify' ? copy.identifyingSystem : copy.identifySystem}
        </button>
        {!currentConnection && <span className="muted">{copy.identifySystemHint}</span>}
      </footer>
    </section>
  )
}
