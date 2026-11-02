import { useEffect, useRef, useState } from 'react'
import type { ExecLimitsSettings } from '../../shared/dto/settings.ts'
import { displayError, serverCopy, type LocaleFace } from '../../shared/i18n.ts'
import { api, requestError } from '../shared/api.ts'
import { useActiveLocale } from '../shared/locale.ts'

interface Row {
  defaultKey: keyof ExecLimitsSettings
  maxKey: keyof ExecLimitsSettings
  title: string
  description: string
  unit: string
}

export function ExecutionSettings(props: { locale: LocaleFace }) {
  const active = useActiveLocale(props.locale)
  const c = serverCopy(active).ui
  const [form, setForm] = useState<ExecLimitsSettings>()
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const version = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    void api<ExecLimitsSettings>('/console-api/server-management-settings', { signal: controller.signal })
      .then(setForm)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause) })
    return () => controller.abort()
  }, [])
  const change = (key: keyof ExecLimitsSettings, value: number | string[]) => {
    version.current += 1
    setSaved(false)
    setDirty(true)
    setError(null)
    setForm((current) => current === undefined ? current : { ...current, [key]: value })
  }
  useEffect(() => {
    if (!dirty || form === undefined || saving) return
    const versionAtSave = version.current
    const timer = setTimeout(() => {
      setSaving(true)
      setError(null)
      void api<ExecLimitsSettings>('/console-api/server-management-settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      })
        .then((next) => {
          if (version.current === versionAtSave) {
            setForm(next)
            setDirty(false)
            setSaved(true)
          }
        })
        .catch((cause: unknown) => {
          setDirty(false)
          setError(cause)
        })
        .finally(() => setSaving(false))
    }, 500)
    return () => clearTimeout(timer)
  }, [dirty, form, saving])
  if (error !== null && form === undefined)
    return <p className="banner error" role="alert">{displayError(active, requestError(error))}</p>
  if (form === undefined) return <p className="muted">{c.settingsLoading}</p>
  const rows: Row[] = [
    {
      defaultKey: 'defaultTimeoutMs',
      maxKey: 'maxTimeoutMs',
      title: c.defaultTimeoutMsLabel,
      description: c.settingsTimeoutHint,
      unit: 'ms',
    },
    {
      defaultKey: 'defaultCommandBytes',
      maxKey: 'maxCommandBytes',
      title: c.defaultCommandBytesLabel,
      description: c.settingsCommandHint,
      unit: c.settingsBytesUnit,
    },
    {
      defaultKey: 'defaultOutputBytes',
      maxKey: 'maxOutputBytes',
      title: c.defaultOutputBytesLabel,
      description: c.settingsOutputHint,
      unit: c.settingsBytesUnit,
    },
  ]
  return (
    <form className="smp-server-exec-settings" onSubmit={(event) => event.preventDefault()}>
      <header>
        <h2>{c.settingsServer}</h2>
        <p className="muted">{c.settingsHint}</p>
      </header>
      <div className="smp-server-exec-rows">
        {rows.map((row) => {
          const id = String(row.defaultKey)
          const isOpen = expanded[id] === true
          return (
            <div className="smp-server-exec-row" key={id}>
              <div className="smp-server-exec-row-text">
                <div className="smp-server-exec-row-title">{row.title}</div>
                <div className="smp-server-exec-row-desc">{row.description}</div>
              </div>
              <div className="smp-server-exec-control">
                <input
                  className="smp-server-exec-value"
                  type="number"
                  step="any"
                  aria-label={`${row.title} ${c.settingsDefault}`}
                  value={form[row.defaultKey]}
                  onChange={(event) => change(row.defaultKey, Number(event.target.value))}
                />
                <span className="smp-server-exec-unit">{row.unit}</span>
                <button
                  type="button"
                  className="smp-server-exec-expander"
                  aria-label={`${row.title} ${c.settingsMaximum}`}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((current) => ({ ...current, [id]: !isOpen }))}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </button>
              </div>
              {isOpen && (
                <div className="smp-server-exec-max">
                  <label>
                    {c.settingsMaximum}
                    <input
                      className="smp-server-exec-value"
                      type="number"
                      step="any"
                      aria-label={`${row.title} ${c.settingsMaximum}`}
                      value={form[row.maxKey]}
                      onChange={(event) => change(row.maxKey, Number(event.target.value))}
                    />
                  </label>
                  <span className="smp-server-exec-unit">{row.unit}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <section className="smp-server-rsync-policy">
        <div className="smp-server-exec-row-title">{c.rsyncDeniedFlagsLabel}</div>
        <div className="smp-server-exec-row-desc">{c.rsyncDeniedFlagsHint}</div>
        <textarea
          className="smp-server-rsync-policy-input"
          aria-label={c.rsyncDeniedFlagsLabel}
          value={form.rsyncDeniedFlags.join('\n')}
          onChange={(event) => change('rsyncDeniedFlags', event.target.value.split('\n').map((line) => line.trim()).filter((line) => line !== ''))}
        />
      </section>
      {error !== null && <p className="banner error" role="alert">{displayError(active, requestError(error))}</p>}
      {saved && !dirty && <p className="banner success" role="status">{c.settingsSaved}</p>}
      {saving && <p className="muted" role="status">{c.settingsSaving}</p>}
    </form>
  )
}
