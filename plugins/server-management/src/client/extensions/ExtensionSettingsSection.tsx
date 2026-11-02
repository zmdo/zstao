import { useCallback, useEffect, useState, useRef } from 'react'
import type { ServerDto } from '../../shared/dto/servers.ts'
import { type ServerError } from '../../shared/errors.ts'
import { displayError, localized, serverCopy } from '../../shared/i18n.ts'
import { RequestScope } from '../shared/request-scope.ts'
import { requestError } from '../shared/api.ts'
import { ExtensionHost } from './ExtensionHost.tsx'
import { extensionApi } from './api.ts'
import { SETTINGS_SECTION_SLOT, type ExtensionCatalogEntry, type RenderSlot, type SlotService } from './slots.ts'

export function ExtensionSettingsSection(props: {
  active: string
  server: ServerDto
  entry: ExtensionCatalogEntry
  renderSlot?: RenderSlot
  slots?: SlotService
  onSaved: () => void
}) {
  const { active, entry, server } = props
  const requests = useRef(new RequestScope()).current
  const copy = serverCopy(active).ui
  const [value, setValue] = useState<unknown>()
  const [draft, setDraft] = useState<unknown>()
  const [revision, setRevision] = useState('0')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [planned, setPlanned] = useState<{ id: string; digest: string; expires_at: string }>()
  const [saved, setSaved] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<ServerError | null>(null)
  const dirty = loaded && !loading && JSON.stringify(value) !== JSON.stringify(draft)

  const load = useCallback(async () => {
    const request = requests.begin()
    setLoading(true)
    setError(null)
    setConflict(false)
    setPlanned(undefined)
    try {
      const current = await extensionApi.settings(server.id, entry.key, request.signal)
      if (!request.current()) return
      setValue(current.value)
      setDraft(current.value)
      setRevision(current.revision)
      setSaved(false)
      setLoaded(true)
    } catch (cause) {
      if (!request.current()) return
      setError(requestError(cause))
    } finally {
      if (request.current()) setLoading(false)
    }
  }, [entry.key, server.id, requests])

  useEffect(() => {
    void load()
    return () => requests.cancel()
  }, [load, requests])

  async function save(): Promise<void> {
    if (!dirty || saving || entry.affectsExecution === true) return
    const request = requests.begin()
    setSaving(true)
    setError(null)
    setConflict(false)
    try {
      const current = await extensionApi.saveSettings(server.id, entry.key, draft, revision)
      if (!request.current()) return
      setValue(current.value)
      setDraft(current.value)
      setRevision(current.revision)
      setSaved(true)
      props.onSaved()
    } catch (cause) {
      if (!request.current()) return
      const next = requestError(cause)
      if (next.code === 'extension_settings_conflict') setConflict(true)
      else setError(next)
    } finally {
      if (request.current()) setSaving(false)
    }
  }

  async function plan(): Promise<void> {
    if (!dirty || saving || entry.affectsExecution !== true) return
    const request = requests.begin()
    setSaving(true)
    setError(null)
    setConflict(false)
    try {
      const next = await extensionApi.planSettings(server.id, entry.key, draft, revision)
      if (request.current()) setPlanned(next)
    } catch (cause) {
      if (!request.current()) return
      const next = requestError(cause)
      if (next.code === 'extension_settings_conflict') setConflict(true)
      else setError(next)
    } finally {
      if (request.current()) setSaving(false)
    }
  }

  async function applyPlan(): Promise<void> {
    if (planned === undefined || saving) return
    const request = requests.begin()
    setSaving(true)
    setError(null)
    setConflict(false)
    try {
      const current = await extensionApi.applySettings(server.id, entry.key, planned.id, planned.digest)
      if (!request.current()) return
      setValue(current.value)
      setDraft(current.value)
      setRevision(current.revision)
      setPlanned(undefined)
      setSaved(true)
      props.onSaved()
    } catch (cause) {
      if (!request.current()) return
      const next = requestError(cause)
      if (next.code === 'extension_settings_conflict') setConflict(true)
      else setError(next)
    } finally {
      if (request.current()) setSaving(false)
    }
  }

  const actions = (
    <>
      {entry.affectsExecution === true ? (
        <>
          {planned !== undefined && (
            <p className="banner">
              {copy.extensionPlanReady} <code>{planned.digest.slice(0, 12)}</code>
            </p>
          )}
          <div className="row smp-settings-actions">
            {planned === undefined ? (
              <button
                className="primary"
                type="button"
                disabled={!dirty || saving || loading}
                onClick={() => { void plan() }}
              >
                {saving ? copy.saving : copy.extensionPlanCreate}
              </button>
            ) : (
              <>
                <button className="primary" type="button" disabled={saving} onClick={() => { void applyPlan() }}>
                  {saving ? copy.saving : copy.extensionPlanApply}
                </button>
                <button className="secondary" type="button" disabled={saving} onClick={() => setPlanned(undefined)}>
                  {copy.extensionPlanCancel}
                </button>
              </>
            )}
            {dirty && <span className="muted">{copy.unsavedChanges}</span>}
          </div>
        </>
      ) : (
        <div className="row smp-settings-actions">
          <button
            className="primary"
            type="button"
            disabled={!dirty || saving || loading}
            onClick={() => { void save() }}
          >
            {saving ? copy.saving : copy.save}
          </button>
          <button className="secondary" type="button" disabled={!dirty || saving} onClick={() => setDraft(value)}>
            {copy.reset}
          </button>
          {dirty && <span className="muted">{copy.unsavedChanges}</span>}
        </div>
      )}
    </>
  )

  return (
    <>
    <div className="smp-extension-settings-pane">
    <div className="smp-extension-settings-body smp-settings-scroll">
    <section className="smp-extension-settings smp-card" aria-label={localized(entry.name, active)}>
      <div className="row smp-extension-settings-head">
        <h3>{localized(entry.name, active)}</h3>
        {saved && !dirty && <span className="muted">{copy.extensionSaved}</span>}
      </div>
      {loading ? (
        <p className="muted">{copy.loading}</p>
      ) : loaded ? (
        <ExtensionHost
          active={active}
          slot={SETTINGS_SECTION_SLOT}
          entry={entry.key}
          owner={{
            server,
            active,
            refresh: props.onSaved,
            api: extensionApi,
            settings: {
              value: draft,
              revision,
              dirty,
              saving,
              error,
              onChange: (value) => {
                if (saving) return
                setDraft(value)
                setPlanned(undefined)
              },
            },
          }}
          renderSlot={props.renderSlot as never}
          slots={props.slots}
        />
      ) : null}
      {error !== null && <p className="banner error">
        {displayError(active, error)}{' '}
        {!loaded && <button className="link" type="button" onClick={() => { void load() }}>{copy.extensionReload}</button>}
      </p>}
      {conflict && (
        <p className="banner error">
          {copy.extensionConflictReload}{' '}
          <button className="link" type="button" onClick={() => { void load() }}>
            {copy.extensionReload}
          </button>
        </p>
      )}
      {entry.affectsExecution === true && <p className="muted">{copy.extensionRequiresPlan}</p>}
    </section>
    </div>
    <div data-extension-actions={entry.key}>{actions}</div>
    </div>
    </>
  )
}
