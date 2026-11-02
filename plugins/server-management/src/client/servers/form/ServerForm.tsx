import { Panel } from '@smp/console-kit'
import { displayError, groupName as localizedGroupName } from '../../../shared/i18n.ts'
import { AuthenticationFields } from './AuthenticationFields.tsx'
import { SystemFields } from './SystemFields.tsx'
import type { ServerFormProps } from './useServerForm.ts'
import { useServerForm } from './useServerForm.ts'
export function ServerForm(props: ServerFormProps) {
  const form = useServerForm(props)
  const {
    active,
    busy,
    canSave,
    changeGroup,
    copy,
    error,
    groupId,
    groups,
    name,
    original,
    pending,
    region,
    save,
    setName,
    setRegion,
  } = form

  return (
    <Panel
      title={props.title ?? (props.editing ? copy.editServer : copy.registerServer)}
      extra={
        props.embedded ? undefined : (
          <button className="link" type="button" onClick={props.onCancel}>
            {copy.back}
          </button>
        )
      }
    >
      {error !== null && (
        <p className="banner error" role="alert">
          {displayError(active, error)}
        </p>
      )}
      <form
        className="panel-form"
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <div className="triple">
          <label className="field">
            {copy.name}
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
          </label>
          <label className="field">
            {copy.group}
            <select
              value={groupId}
              disabled={props.editing}
              onChange={(event) => {
                changeGroup(event.target.value)
              }}
            >
              <option value="">{copy.ungrouped}</option>
              {groups.map((group) => (
                <option
                  key={group.id}
                  value={group.id}
                  disabled={!group.available && group.id !== original?.groupId}
                >
                  {localizedGroupName(active, group)}
                  {group.available ? '' : ` (${copy.pluginUnavailable})`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {copy.region}
            <input
              value={region}
              onChange={(event) => {
                setRegion(event.target.value)
              }}
              placeholder={copy.autoRegion}
            />
          </label>
        </div>
        <AuthenticationFields form={form} />
        <SystemFields form={form} editing={props.editing} />
        <div className="row">
          <button className="primary" type="submit" disabled={busy || pending !== null || !canSave}>
            {copy.save}
          </button>
        </div>
      </form>
    </Panel>
  )
}
