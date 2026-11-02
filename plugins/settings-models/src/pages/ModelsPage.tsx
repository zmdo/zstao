import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { modelsCopy } from '../copy.ts'
import { deriveKeyRef } from '../profiles.ts'
import { addedRows, createOps, draftError, fieldOp, matchProvider, missingDiscovery, modelRows, modelsOp, protocolWire, providerBaseURL, providerChoices, providerRoute, removeOp, resolveProvider, storedModels, toggleAllModels, type ModelName, type ModelRow, type ProtocolChoice, type ProviderDraft, type ProviderSource, type SettingsNamespace } from '../rows.ts'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface RemoteResult<T> {
  ok: boolean
  value?: T
  error?: { message?: string }
}

interface SettingsView {
  namespaces: SettingsNamespace[]
}

interface RemoteLlm {
  listConfigurableProviders(): Promise<RemoteResult<ProviderSource[]>>
  discoverModels(settingsNs: string, request: { provider: string }): Promise<RemoteResult<ModelName[]>>
}

interface RemoteSettings {
  describe(): Promise<RemoteResult<SettingsView>>
  mutate(ns: string, ops: readonly ReturnType<typeof fieldOp>[], revision: number): Promise<RemoteResult<unknown>>
}

interface RemoteCredentials {
  describe(refs: readonly string[]): Promise<RemoteResult<Record<string, { configured?: boolean }>>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
}

type Discovered = { status: 'loading' } | { status: 'ready'; models: ModelName[] } | { status: 'error'; message: string }

const PAGE_STYLE = `
.smp-models-table > tbody > tr > td > input, .smp-models-table > tbody > tr > td > select { width: 100%; box-sizing: border-box; }
.smp-models-table .detail { color: var(--muted); }
.smp-console form.panel-form.smp-models-add { margin-bottom: 16px; }
.smp-console form.smp-models-add > label > input,
.smp-console form.smp-models-add > label > select,
.smp-console form.smp-models-add .smp-provider-field > input { width: 100%; max-width: 100%; box-sizing: border-box; }
.smp-provider-field { position: relative; display: block; min-width: 0; }
.smp-provider-menu {
  position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0;
  max-height: 240px; overflow: auto; margin: 0; padding: 4px 0;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--border); border-radius: 4px;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.12);
}
.smp-console .smp-provider-menu button {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; height: auto; min-height: 32px; border: 0; border-radius: 0;
  background: transparent; color: var(--text); text-align: left; padding: 6px 10px;
}
.smp-console .smp-provider-menu button:hover { background: var(--primary-soft); }
.smp-model-picker { border: 1px solid var(--line); border-radius: 4px; }
.smp-model-scroll { max-height: calc(36px * 10); overflow: auto; }
.smp-console .smp-model-picker table { table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.smp-console .smp-model-picker th, .smp-console .smp-model-picker td { height: 36px; padding: 0 12px; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--line); }
.smp-console .smp-model-picker thead th { background: #fafafa; }
.smp-console .smp-model-picker th.check, .smp-console .smp-model-picker td.check, .smp-console .smp-model-picker col.check { width: 44px; }
.smp-model-add { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-top: 8px; }
.smp-console table.smp-models-table tbody tr.smp-models-row { cursor: pointer; }
.smp-console table.smp-models-table tbody tr.smp-models-row:hover td, .smp-console table.smp-models-table tbody tr.smp-models-row.is-open td { background: #f7f9fc; }
.smp-model-add input { width: 100%; min-width: 0; box-sizing: border-box; }
`

export function installModelsStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-settings-models'
  tag.textContent = PAGE_STYLE
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

function namedModels(models: readonly { id: string; name?: string }[]): ModelName[] {
  return models.map(model => ({ id: model.id, name: model.name === undefined || model.name === '' ? model.id : model.name }))
}

function messageOf(error: { message?: string } | undefined, fallback: string): string {
  return error?.message !== undefined && error.message !== '' ? error.message : fallback
}

export function ModelsPage(props: {
  locale: LocaleFace
  llm: RemoteLlm
  settings: RemoteSettings
  credentials: RemoteCredentials
}) {
  const locale = useSyncExternalStore(listener => props.locale.subscribe(listener), () => props.locale.getSnapshot())
  const copy = modelsCopy(locale.active)
  const [catalog, setCatalog] = useState<ProviderSource[]>([])
  const [documents, setDocuments] = useState<SettingsNamespace[]>([])
  const [rows, setRows] = useState<ModelRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | undefined>(undefined)
  const [found, setFound] = useState<Record<string, Discovered>>({})
  const [adding, setAdding] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stopped = false
    const load = async (): Promise<void> => {
      const [providers, settings] = await Promise.all([
        props.llm.listConfigurableProviders(),
        props.settings.describe(),
      ])
      if (stopped) return
      if (!providers.ok || providers.value === undefined) {
        setError(messageOf(providers.error, copy.loadFailed))
        return
      }
      if (!settings.ok || settings.value === undefined) {
        setError(messageOf(settings.error, copy.loadFailed))
        return
      }
      const directory = providers.value.filter(provider => provider.provider !== 'deepseek-account')
      const next = addedRows(directory, settings.value.namespaces)
      const refs = [...new Set(next.flatMap(row => row.credentialRef === undefined ? [] : [row.credentialRef]))]
      const described = refs.length === 0 ? { ok: true, value: {} } : await props.credentials.describe(refs)
      if (stopped) return
      if (!described.ok || described.value === undefined) {
        setError(messageOf(described.error, copy.loadFailed))
        return
      }
      const configured: Record<string, boolean> = {}
      for (const row of next) {
        if (row.credentialRef === undefined) continue
        configured[row.provider] = described.value[row.credentialRef]?.configured === true
      }
      setCatalog(directory)
      setDocuments(settings.value.namespaces)
      setRows(next)
      setKeys(configured)
      setError('')
    }
    void load().catch((cause: unknown) => {
      if (!stopped) setError(cause instanceof Error ? cause.message : copy.loadFailed)
    })
    return () => { stopped = true }
  }, [props.llm, props.settings, props.credentials, copy.loadFailed, reloadKey])

  const reload = (): void => { setReloadKey(current => current + 1) }

  const reveal = (row: ModelRow): void => {
    setOpen(current => current === row.provider ? undefined : row.provider)
    if (row.models.length > 0 || found[row.provider] !== undefined) return
    setFound(current => ({ ...current, [row.provider]: { status: 'loading' } }))
    void props.llm.discoverModels(row.settingsNs, { provider: row.provider }).then(response => {
      const fallback = missingDiscovery(response.error?.message) ? storedModels(documents, {
        provider: row.provider,
        displayName: row.displayName,
        settingsNs: row.settingsNs,
        settingsPath: row.settingsPath,
      }) : undefined
      setFound(current => ({
        ...current,
        [row.provider]: response.ok && response.value !== undefined
          ? { status: 'ready', models: namedModels(response.value) }
          : fallback !== undefined
            ? { status: 'ready', models: fallback }
            : { status: 'error', message: messageOf(response.error, copy.loadFailed) },
      }))
    }).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : copy.loadFailed
      const fallback = missingDiscovery(message) ? storedModels(documents, {
        provider: row.provider,
        displayName: row.displayName,
        settingsNs: row.settingsNs,
        settingsPath: row.settingsPath,
      }) : undefined
      setFound(current => ({
        ...current,
        [row.provider]: fallback !== undefined
          ? { status: 'ready', models: fallback }
          : { status: 'error', message },
      }))
    })
  }

  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const visibleRows = rows.slice((current - 1) * pageSize, current * pageSize)

  return (
    <Panel
      className="smp-list-panel"
      title={copy.title}
      extra={<button className="primary" type="button" onClick={() => setAdding(true)}>{copy.add}</button>}
    >
      {error !== '' && <p className="banner error">{error}</p>}
      {adding ? (
        <AddProvider
          copy={copy}
          catalog={catalog.filter(provider => !rows.some(row => row.provider === provider.provider))}
          documents={documents}
          llm={props.llm}
          settings={props.settings}
          credentials={props.credentials}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); reload() }}
          onError={setError}
        />
      ) : null}
      {rows.length === 0 ? <p className="empty">{copy.empty}</p> : (
        <div className="table-wrap smp-list-scroll">
          <table className="smp-models-table smp-table">
            <thead>
              <tr>
                <th>{copy.provider}</th>
                <th>{copy.baseUrl}</th>
                <th>{copy.protocol}</th>
                <th>{copy.apiKey}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <ModelLine
                  key={row.provider}
                  row={row}
                  copy={copy}
                  expanded={open === row.provider}
                  discovered={found[row.provider]}
                  keyConfigured={keys[row.provider] === true}
                  onToggle={() => reveal(row)}
                  onRow={next => setRows(current => current.map(item => item.provider === next.provider ? next : item))}
                  onKey={configured => setKeys(current => ({ ...current, [row.provider]: configured }))}
                  onError={setError}
                  onRemove={reload}
                  settings={props.settings}
                  credentials={props.credentials}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="smp-server-pager smp-list-pager" aria-label={copy.pagination}>
        <span>{rows.length ? copy.range.replace('{count}', String(rows.length)).replace('{from}', String((current - 1) * pageSize + 1)).replace('{to}', String(Math.min(current * pageSize, rows.length))) : copy.total.replace('{count}', '0')}</span>
        <div className="row">
          <label>
            {copy.perPage}
            <select aria-label={copy.pageSize} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}>
              {[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button className="secondary" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>{copy.previous}</button>
          <span aria-live="polite">{copy.page.replace('{page}', String(current)).replace('{pages}', String(pages))}</span>
          <button className="secondary" type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>{copy.next}</button>
        </div>
      </footer>
    </Panel>
  )
}

function ModelLine(props: {
  row: ModelRow
  copy: ReturnType<typeof modelsCopy>
  expanded: boolean
  discovered: Discovered | undefined
  keyConfigured: boolean
  onToggle(): void
  onRow(row: ModelRow): void
  onKey(configured: boolean): void
  onError(message: string): void
  onRemove(): void
  settings: RemoteSettings
  credentials: RemoteCredentials
}) {
  const { row, copy } = props
  const [baseURL, setBaseURL] = useState(row.baseURL)
  const [protocol, setProtocol] = useState<ProtocolChoice>(row.protocol)
  const [apiKey, setApiKey] = useState('')

  useEffect(() => { setBaseURL(row.baseURL) }, [row.baseURL])
  useEffect(() => { setProtocol(row.protocol) }, [row.protocol])

  const writeField = async (field: string, value: string): Promise<void> => {
    const response = await props.settings.mutate(row.settingsNs, [fieldOp(row.settingsPath, field, value)], row.revision)
    if (!response.ok) {
      props.onError(messageOf(response.error, copy.saveFailed))
      return
    }
    const described = await props.settings.describe()
    props.onError('')
    if (!described.ok || described.value === undefined) return
    const source: ProviderSource = {
      provider: row.provider,
      displayName: row.displayName,
      settingsNs: row.settingsNs,
      settingsPath: row.settingsPath,
      defaultBaseURL: row.defaultBaseURL,
    }
    const refreshed = modelRows([source], described.value.namespaces)[0]
    if (refreshed !== undefined) props.onRow(refreshed)
  }

  const stored = row.models
  const choices = stored.length > 0
    ? mergeModels(stored, props.discovered?.status === 'ready' ? props.discovered.models : [])
    : props.discovered?.status === 'ready' ? props.discovered.models : stored
  const pending = props.discovered === undefined || props.discovered.status === 'loading'
  const [picked, setPicked] = useState<string[]>(stored.map(model => model.id))

  useEffect(() => { setPicked(row.models.map(model => model.id)) }, [row.models])

  const remove = async (): Promise<void> => {
    const op = removeOp(row.settingsPath)
    if (op === undefined) return
    const response = await props.settings.mutate(row.settingsNs, [op], row.revision)
    if (!response.ok) {
      props.onError(messageOf(response.error, copy.saveFailed))
      return
    }
    props.onError('')
    props.onRemove()
  }

  return (
    <>
      <tr
        className={props.expanded ? 'smp-models-row is-open' : 'smp-models-row'}
        role="button"
        aria-label={row.displayName}
        aria-expanded={props.expanded}
        tabIndex={0}
        onClick={event => {
          if ((event.target as HTMLElement).closest('input, select, textarea, button, label, a')) return
          props.onToggle()
        }}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          if ((event.target as HTMLElement).closest('input, select, textarea, button, label, a')) return
          event.preventDefault()
          props.onToggle()
        }}
      >
        <td>{row.displayName}</td>
        <td>
          <input
            aria-label={`${row.displayName} ${copy.baseUrl}`}
            value={baseURL}
            placeholder={row.defaultBaseURL}
            onChange={event => setBaseURL(event.target.value)}
            onBlur={() => {
              if (baseURL.trim() === row.baseURL) return
              void writeField('baseURL', baseURL)
            }}
          />
        </td>
        <td>
          <select
            aria-label={`${row.displayName} ${copy.protocol}`}
            value={protocol}
            disabled={!row.protocolEditable}
            onChange={event => {
              if (!row.protocolEditable) return
              const choice = event.target.value === 'openai' || event.target.value === 'anthropic' ? event.target.value : ''
              if (choice === row.protocol) {
                setProtocol(choice)
                return
              }
              setProtocol(choice)
              void writeField('api', protocolWire(choice) ?? '')
            }}
          >
            <option value="">{copy.protocolDefault}</option>
            <option value="openai">{copy.openai}</option>
            <option value="anthropic">{copy.anthropic}</option>
          </select>
        </td>
        <td>
          {row.credentialRef === undefined ? null : (
            <input
              aria-label={`${row.displayName} ${copy.apiKey}`}
              type="password"
              value={apiKey}
              placeholder={props.keyConfigured ? copy.keySet : copy.keyMissing}
              autoComplete="off"
              onChange={event => setApiKey(event.target.value)}
              onBlur={() => {
                const value = apiKey.trim()
                if (value === '' || row.credentialRef === undefined) return
                void props.credentials.set(row.credentialRef, value).then(response => {
                  if (!response.ok) {
                    props.onError(messageOf(response.error, copy.saveFailed))
                    return
                  }
                  setApiKey('')
                  props.onKey(true)
                  props.onError('')
                })
              }}
            />
          )}
        </td>
        <td>
          {removeOp(row.settingsPath) === undefined ? null : (
            <button className="link" type="button" onClick={() => { void remove() }}>{copy.remove}</button>
          )}
        </td>
      </tr>
      {props.expanded && (
        <tr>
          <td className="detail" colSpan={5}>
            <div>{copy.available}</div>
            {pending && choices.length === 0 ? <p className="muted">{copy.loading}</p>
              : props.discovered?.status === 'error' && choices.length === 0 ? <p className="banner error">{props.discovered.message}</p>
                : (
                  <>
                    <ModelChoices
                      models={choices}
                      selected={picked}
                      onChange={setPicked}
                      addLabel={copy.addModel}
                      nameLabel={copy.modelName}
                      idLabel={copy.modelId}
                      selectAllLabel={copy.selectAll}
                      emptyLabel={copy.noModels}
                    />
                    <p>
                      <button
                        className="primary"
                        type="button"
                        onClick={() => {
                          const models = selectedModels(choices, picked)
                          void props.settings.mutate(row.settingsNs, [modelsOp(row.settingsPath, models)], row.revision).then(response => {
                            if (!response.ok) {
                              props.onError(messageOf(response.error, copy.saveFailed))
                              return
                            }
                            props.onError('')
                            props.onRow({ ...row, models })
                          })
                        }}
                      >
                        {copy.save}
                      </button>
                    </p>
                  </>
                )}
          </td>
        </tr>
      )}
    </>
  )
}

function mergeModels(stored: readonly ModelName[], discovered: readonly ModelName[]): ModelName[] {
  const seen = new Set(stored.map(model => model.id))
  return [...stored, ...discovered.filter(model => !seen.has(model.id))]
}

function ModelChoices(props: {
  models: readonly ModelName[]
  selected: readonly string[]
  onChange(ids: string[]): void
  addLabel: string
  nameLabel: string
  idLabel: string
  selectAllLabel: string
  emptyLabel: string
}) {
  const [extra, setExtra] = useState('')
  const allBox = useRef<HTMLInputElement>(null)
  const models = [
    ...props.models,
    ...props.selected.filter(id => !props.models.some(model => model.id === id)).map(id => ({ id, name: id })),
  ]
  const visible = models.map(model => model.id)
  const chosen = visible.filter(id => props.selected.includes(id)).length
  const allOn = visible.length > 0 && chosen === visible.length
  const partial = chosen > 0 && !allOn
  useEffect(() => {
    if (allBox.current !== null) allBox.current.indeterminate = partial
  }, [partial])
  const toggle = (id: string, checked: boolean): void => {
    props.onChange(checked ? [...props.selected, id] : props.selected.filter(item => item !== id))
  }
  return (
    <>
      <div className="smp-model-picker">
        <table className="smp-table">
          <colgroup>
            <col className="check" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="check">
                <input
                  ref={allBox}
                  type="checkbox"
                  aria-label={props.selectAllLabel}
                  checked={allOn}
                  disabled={visible.length === 0}
                  onChange={event => props.onChange(toggleAllModels(visible, props.selected, event.target.checked))}
                />
              </th>
              <th>{props.nameLabel}</th>
              <th>{props.idLabel}</th>
            </tr>
          </thead>
        </table>
        <div className="smp-model-scroll">
          <table className="smp-table">
            <colgroup>
              <col className="check" />
              <col />
              <col />
            </colgroup>
            <tbody>
              {models.length === 0 ? (
                <tr><td className="check" /><td colSpan={2}>{props.emptyLabel}</td></tr>
              ) : models.map(model => (
                <tr key={model.id}>
                  <td className="check">
                    <input
                      type="checkbox"
                      aria-label={model.name}
                      checked={props.selected.includes(model.id)}
                      onChange={event => toggle(model.id, event.target.checked)}
                    />
                  </td>
                  <td>{model.name}</td>
                  <td className="mono">{model.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="smp-model-add">
        <input
          aria-label={props.addLabel}
          value={extra}
          onChange={event => setExtra(event.target.value)}
        />
        <button
          className="secondary"
          type="button"
          onClick={() => {
            const id = extra.trim()
            if (id === '') return
            if (!props.models.some(model => model.id === id)) props.onChange([...props.selected, id])
            else if (!props.selected.includes(id)) props.onChange([...props.selected, id])
            setExtra('')
          }}
        >
          {props.addLabel}
        </button>
      </div>
    </>
  )
}

function AddProvider(props: {
  copy: ReturnType<typeof modelsCopy>
  catalog: readonly ProviderSource[]
  documents: readonly SettingsNamespace[]
  llm: RemoteLlm
  settings: RemoteSettings
  credentials: RemoteCredentials
  onClose(): void
  onSaved(): void
  onError(message: string): void
}) {
  const { copy } = props
  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [protocol, setProtocol] = useState<ProtocolChoice>('')
  const [apiKey, setApiKey] = useState('')
  const [options, setOptions] = useState<ModelName[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const known = resolveProvider(props.catalog, name)
  const route = known?.provider ?? providerRoute(name)
  const choices = providerChoices(props.catalog, name)
  const filledFrom = useRef<string | undefined>(undefined)

  useEffect(() => { setSelected([]) }, [known?.provider])

  useEffect(() => {
    const next = known === undefined ? '' : providerBaseURL(known, props.documents)
    setBaseURL(current => {
      if (current.trim() !== '' && current !== filledFrom.current) return current
      filledFrom.current = next === '' ? undefined : next
      return next
    })
  }, [known, props.documents])

  useEffect(() => {
    if (known === undefined) {
      setOptions([])
      return
    }
    setOptions([])
    let stopped = false
    const source = known
    const apply = (models: ModelName[]): void => {
      if (stopped) return
      setOptions(models)
      props.onError('')
    }
    void props.llm.discoverModels(source.settingsNs, { provider: source.provider }).then(response => {
      if (stopped) return
      if (response.ok && Array.isArray(response.value)) {
        apply(namedModels(response.value))
        return
      }
      if (missingDiscovery(response.error?.message)) {
        apply(storedModels(props.documents, source))
        return
      }
      setOptions([])
      props.onError(messageOf(response.error, copy.loadFailed))
    }).catch((cause: unknown) => {
      if (stopped) return
      const message = cause instanceof Error ? cause.message : copy.loadFailed
      if (missingDiscovery(message)) {
        apply(storedModels(props.documents, source))
        return
      }
      setOptions([])
      props.onError(message)
    })
    return () => { stopped = true }
  }, [known?.provider, known?.settingsNs, props.documents, props.llm, props.onError, copy.loadFailed])

  const problem = (): string => {
    const models = selectedModels(options, selected)
    const code = draftError({
      route: route ?? name,
      displayName: known?.displayName ?? name.trim(),
      baseURL,
      protocol,
      models,
      withKey: apiKey.trim() !== '',
    }, known !== undefined)
    if (code === 'route') return copy.routeInvalid
    if (code === 'protocol') return copy.needProtocol
    if (code === 'baseUrl') return copy.needBaseUrl
    if (code === 'models') return copy.needModels
    return ''
  }

  const save = async (): Promise<void> => {
    const failure = problem()
    if (failure !== '' || route === undefined) {
      props.onError(failure === '' ? copy.routeInvalid : failure)
      return
    }
    const source: ProviderSource = known ?? {
      provider: route,
      displayName: name.trim(),
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', route],
    }
    const chosen = selectedModels(options, selected)
    const draft: ProviderDraft = {
      route,
      displayName: source.displayName,
      baseURL: baseURL.trim() === '' ? source.defaultBaseURL ?? '' : baseURL.trim(),
      protocol,
      models: chosen,
      withKey: apiKey.trim() !== '',
    }
    const again = draftError(draft, known !== undefined)
    if (again !== undefined) {
      props.onError(problem())
      return
    }
    const document = props.documents.find(item => item.ns === source.settingsNs)
    setBusy(true)
    const written = await props.settings.mutate(source.settingsNs, createOps(draft, source), document?.revision ?? 0)
    if (!written.ok) {
      setBusy(false)
      props.onError(messageOf(written.error, copy.saveFailed))
      return
    }
    if (apiKey.trim() !== '') {
      const stored = await props.credentials.set(deriveKeyRef(source.provider), apiKey.trim())
      if (!stored.ok) {
        setBusy(false)
        props.onError(messageOf(stored.error, copy.saveFailed))
        return
      }
    }
    setBusy(false)
    props.onError('')
    props.onSaved()
  }

  return (
    <form
      className="panel-form smp-models-add"
      onSubmit={event => {
        event.preventDefault()
        void save()
      }}
    >
      <label>
        {copy.provider}
        <span className="smp-provider-field">
          <input
            aria-label={copy.provider}
            aria-expanded={menu}
            aria-controls="smp-provider-menu"
            value={name}
            placeholder={copy.providerHint}
            required
            autoComplete="off"
            onFocus={() => setMenu(true)}
            onChange={event => { setName(event.target.value); setMenu(true) }}
            onBlur={() => {
              setMenu(false)
              const picked = matchProvider(props.catalog, name)
              if (picked === undefined) return
              setName(picked.provider)
            }}
          />
          {menu && choices.length > 0 && (
            <div className="smp-provider-menu" id="smp-provider-menu" role="listbox">
              {choices.map(provider => (
                <button
                  key={provider.provider}
                  type="button"
                  role="option"
                  onMouseDown={event => {
                    event.preventDefault()
                    setName(provider.provider)
                    setMenu(false)
                  }}
                >
                  <span>{provider.displayName}</span>
                  <span className="muted">{provider.provider}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      </label>
      <label>
        {copy.baseUrl}
        <input aria-label={copy.baseUrl} value={baseURL} placeholder={known?.defaultBaseURL ?? ''} onChange={event => setBaseURL(event.target.value)} />
      </label>
      <label>
        {copy.protocol}
        <select
          aria-label={copy.protocol}
          value={protocol}
          disabled={known !== undefined && known.settingsNs !== 'llm-pi-ai'}
          onChange={event => {
            const choice = event.target.value === 'openai' || event.target.value === 'anthropic' ? event.target.value : ''
            setProtocol(choice)
          }}
        >
          <option value="">{copy.protocolDefault}</option>
          <option value="openai">{copy.openai}</option>
          <option value="anthropic">{copy.anthropic}</option>
        </select>
      </label>
      <label>
        {copy.apiKey}
        <input aria-label={copy.apiKey} type="password" value={apiKey} autoComplete="off" onChange={event => setApiKey(event.target.value)} />
      </label>
      <div className="field">
        <span>{copy.available}</span>
        <ModelChoices
          models={options}
          selected={selected}
          onChange={setSelected}
          addLabel={copy.addModel}
          nameLabel={copy.modelName}
          idLabel={copy.modelId}
          selectAllLabel={copy.selectAll}
          emptyLabel={copy.noModels}
        />
      </div>
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>{copy.save}</button>
        <button className="secondary" type="button" onClick={props.onClose}>{copy.cancel}</button>
      </div>
    </form>
  )
}

function selectedModels(options: readonly ModelName[], selected: readonly string[]): ModelName[] {
  return [
    ...options.filter(model => selected.includes(model.id)),
    ...selected.filter(id => !options.some(model => model.id === id)).map(id => ({ id, name: id })),
  ]
}
