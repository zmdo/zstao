import { displayError, serverCopy } from '../../../shared/i18n.ts'
import { SoftwarePolicies } from '../components/SoftwarePolicies.tsx'
import type { ServerFormModel } from '../form/useServerForm.ts'

export function PolicySettings(props: { active: string; form: ServerFormModel }) {
  const { active, form } = props
  const copy = serverCopy(active).ui
  return (
    <form
      className="panel-form smp-settings-form"
      onSubmit={(event) => {
        event.preventDefault()
        void form.savePolicies()
      }}
    >
      <div className="smp-settings-form-body smp-settings-scroll">
      <SoftwarePolicies
        active={active}
        software={form.configuredSoftware}
        value={form.policies}
        onChange={form.setPolicies}
        installed={form.softwareStatus}
      />
      <label className="smp-server-auto-install">
        <input
          type="checkbox"
          checked={form.software.length > 0 && form.auto}
          disabled={form.software.length === 0 || !form.available}
          onChange={(event) => {
            form.setAuto(event.target.checked)
          }}
        />{' '}
        {copy.autoInstall}
      </label>
      {form.error !== null && <p className="banner error">{displayError(active, form.error)}</p>}
      </div>
      <div className="row smp-settings-actions">
        <button className="primary" type="submit" disabled={form.busy || !form.canSavePolicies}>
          {form.busy ? copy.saving : copy.save}
        </button>
        {form.policiesDirty && <span className="muted">{copy.unsavedChanges}</span>}
      </div>
    </form>
  )
}
