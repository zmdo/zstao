import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { copyFor, type Copy } from './copy.ts'

export interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

const API = '/console-api/cos'

interface ConfigEntry {
  role: 'attachments' | 'default'
  bucket: string
  region: string
  secretId: string
  hasSecretKey: boolean
  basePrefix: string
  maxUploadBytes: number
  enabled: boolean
}

interface ConfigResponse {
  attachments: ConfigEntry | null
  default: ConfigEntry | null
}

interface ObjectItem {
  kind: 'folder' | 'file'
  key: string
  name: string
  size: number | null
  lastModified: string | null
}

interface ObjectPage {
  items: ObjectItem[]
  nextMarker: string
  truncated: boolean
}

interface AuditItem {
  id: string
  sessionId: string | null
  actor: string
  action: string
  objectKey: string
  sizeBytes: number | null
  ok: boolean
  error: string | null
  detail: unknown
  createdAt: string
}

function useCopy(locale: LocaleFace): Copy {
  const active = useSyncExternalStore(
    (listener) => locale.subscribe(listener),
    () => locale.getSnapshot().active,
  )
  return copyFor(active)
}

function activeLocale(locale: LocaleFace): string {
  return locale.getSnapshot().active
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { credentials: 'same-origin', ...init })
  const text = await response.text()
  const payload = text === '' ? {} : JSON.parse(text)
  if (!response.ok) {
    const detail = (payload as { detail?: string }).detail ?? `HTTP ${response.status}`
    throw new Error(detail)
  }
  return payload as T
}

function formatTime(iso: string | null, active: string): string {
  if (iso === null) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(active.startsWith('en') ? 'en-US' : 'zh-CN')
}

function formatSize(bytes: number | null, copy: Copy): string {
  if (bytes === null) return copy.folders
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const TEXT_EXT = new Set(['txt', 'md', 'json', 'csv', 'log', 'yaml', 'yml', 'ts', 'js', 'css', 'html', 'xml', 'sh', 'ini', 'toml'])

export function FilesPage(props: { locale: LocaleFace }) {
  const copy = useCopy(props.locale)
  const active = activeLocale(props.locale)
  const [prefix, setPrefix] = useState('')
  const [items, setItems] = useState<ObjectItem[]>([])
  const [markers, setMarkers] = useState<string[]>([''])
  const [nextMarker, setNextMarker] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<{ key: string; name: string; kind: 'text' | 'image' | 'pdf' } | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [unsupported, setUnsupported] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const load = async (nextPrefix: string, marker: string, query: string, size = pageSize) => {
    setLoading(true)
    setError('')
    try {
      const page = await requestJson<ObjectPage>(
        `/objects?prefix=${encodeURIComponent(nextPrefix)}&marker=${encodeURIComponent(marker)}&limit=${size}&search=${encodeURIComponent(query)}`,
      )
      setItems(page.items)
      setNextMarker(page.nextMarker)
      setTruncated(page.truncated)
      setPrefix(nextPrefix)
      setSearch(query)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('', '', '', 20)
  }, [])

  const openFolder = (key: string) => {
    setMarkers([''])
    void load(key, '', '')
  }

  const openPreview = async (item: ObjectItem) => {
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    const kind = IMAGE_EXT.has(ext) ? 'image' : ext === 'pdf' ? 'pdf' : TEXT_EXT.has(ext) ? 'text' : null
    if (kind === null) {
      setUnsupported(item.name)
      return
    }
    setPreview({ key: item.key, name: item.name, kind })
    setPreviewText('')
    setPreviewError('')
    if (kind !== 'text') return
    setPreviewLoading(true)
    try {
      const data = await requestJson<{ text: string }>(`/objects/text?key=${encodeURIComponent(item.key)}`)
      setPreviewText(data.text)
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPreviewLoading(false)
    }
  }

  const upload = (files: FileList | null) => {
    if (files === null) return
    for (const file of Array.from(files)) {
      const key = `${prefix}${file.name}`
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API}/objects?key=${encodeURIComponent(key)}&overwrite=false`)
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setProgress((state) => ({ ...state, [file.name]: Math.round((event.loaded / event.total) * 100) }))
      }
      xhr.onload = () => {
        setProgress((state) => {
          const next = { ...state }
          delete next[file.name]
          return next
        })
        if (xhr.status < 200 || xhr.status > 299) setError(parseError(xhr.responseText) ?? copy.uploadFailed)
        void load(prefix, markers[markers.length - 1] ?? '', search)
      }
      xhr.onerror = () => setError(copy.uploadFailed)
      xhr.send(file)
    }
    if (input.current !== null) input.current.value = ''
  }

  const remove = async (key: string) => {
    if (!window.confirm(copy.confirmDelete)) return
    try {
      const response = await fetch(`${API}/objects?key=${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'same-origin' })
      if (!response.ok) throw new Error(parseError(await response.text()) ?? `HTTP ${response.status}`)
      void load(prefix, markers[markers.length - 1] ?? '', search)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const segments = prefix.split('/').filter((part) => part !== '')
  const crumbs = [{ label: copy.root, prefix: '' }, ...segments.map((part, index) => ({ label: part, prefix: `${segments.slice(0, index + 1).join('/')}/` }))]

  return (
    <Panel
      className="smp-list-panel"
      title={copy.filesTitle}
      extra={
        <div className="row smp-plugins-head-extra">
          <input
            className="search"
            type="search"
            placeholder={copy.searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load(prefix, '', search)
            }}
          />
          <button type="button" className="secondary" onClick={() => void load(prefix, '', search)}>
            {copy.refresh}
          </button>
          <button type="button" onClick={() => input.current?.click()}>
            {copy.upload}
          </button>
          <input ref={input} type="file" multiple hidden onChange={(event) => upload(event.target.files)} />
        </div>
      }
    >
      <nav className="smp-cos-crumbs">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.prefix}>
            {index > 0 && <span>/</span>}
            <button type="button" className="smp-cos-crumb" onClick={() => void load(crumb.prefix, '', '')}>
              {crumb.label}
            </button>
          </Fragment>
        ))}
      </nav>
      {error !== '' && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {truncated && <p className="smp-cos-note">{copy.truncated}</p>}
      {Object.keys(progress).length > 0 && (
        <p className="smp-cos-note">
          {Object.entries(progress)
            .map(([name, value]) => `${name} ${value}%`)
            .join(' · ')}
        </p>
      )}
      <div className="table-wrap smp-list-scroll">
        <table className="smp-plugins smp-table">
          <thead>
            <tr>
              <th>{copy.name}</th>
              <th>{copy.size}</th>
              <th>{copy.updated}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.key}
                className="smp-plugin-row"
                onClick={() => {
                  if (item.kind === 'folder') openFolder(item.key)
                  else void openPreview(item)
                }}
              >
                <td>
                  {item.kind === 'folder' ? (
                    <button
                      type="button"
                      className="smp-cos-folder"
                      onClick={(event) => {
                        event.stopPropagation()
                        openFolder(item.key)
                      }}
                    >
                      {item.name}/
                    </button>
                  ) : (
                    item.name
                  )}
                </td>
                <td className="nowrap">{item.kind === 'folder' ? copy.folders : formatSize(item.size, copy)}</td>
                <td className="nowrap">{formatTime(item.lastModified, active)}</td>
                <td>
                  <div className="row">
                    {item.kind === 'file' && (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          onClick={(event) => {
                            event.stopPropagation()
                            window.location.href = `${API}/objects/download?key=${encodeURIComponent(item.key)}`
                          }}
                        >
                          {copy.download}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={(event) => {
                            event.stopPropagation()
                            void remove(item.key)
                          }}
                        >
                          {copy.delete}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {error === '' ? copy.empty : copy.loadFailed}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={4} className="empty">
                  {copy.loading}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="smp-plugins-pager smp-list-pager">
        <span className="muted">{`${items.length} ${copy.items}`}</span>
        <div className="row">
          <label>
            {copy.perPage}
            <select
              className="smp-page-size"
              aria-label={copy.perPage}
              value={pageSize}
              onChange={(event) => {
                const size = Number(event.target.value)
                setPageSize(size)
                setMarkers([''])
                void load(prefix, '', '', size)
              }}
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            disabled={markers.length <= 1}
            onClick={() => {
              const next = markers.slice(0, -1)
              setMarkers(next)
              void load(prefix, next[next.length - 1] ?? '', search)
            }}
          >
            {copy.previous}
          </button>
          <span>{copy.pageOf.replace('{page}', String(markers.length))}</span>
          <button
            type="button"
            className="secondary"
            disabled={nextMarker === ''}
            onClick={() => {
              const next = [...markers, nextMarker]
              setMarkers(next)
              void load(prefix, nextMarker, '')
            }}
          >
            {copy.next}
          </button>
        </div>
      </div>
      {preview !== null && (
        <aside className="smp-cos-drawer" role="dialog" aria-label={preview.name}>
          <header className="smp-cos-drawer-head">
            <strong className="smp-cos-drawer-title">{preview.name}</strong>
            <div className="row">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  window.location.href = `${API}/objects/download?key=${encodeURIComponent(preview.key)}`
                }}
              >
                {copy.download}
              </button>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>
                {copy.close}
              </button>
            </div>
          </header>
          <div className="smp-cos-drawer-body">
            {preview.kind === 'text' &&
              (previewLoading ? (
                <p className="muted">{copy.previewLoading}</p>
              ) : previewError !== '' ? (
                <p className="banner error">{previewError}</p>
              ) : (
                <pre className="smp-cos-preview-text">{previewText}</pre>
              ))}
            {preview.kind === 'image' && (
              <img className="smp-cos-preview-image" src={`${API}/objects/raw?key=${encodeURIComponent(preview.key)}`} alt={preview.name} />
            )}
            {preview.kind === 'pdf' && (
              <iframe className="smp-cos-preview-frame" src={`${API}/objects/raw?key=${encodeURIComponent(preview.key)}`} title={preview.name} />
            )}
          </div>
        </aside>
      )}
      {unsupported !== '' && (
        <div className="smp-cos-modal" role="alertdialog" aria-modal="true">
          <div className="smp-cos-modal-card">
            <h3>{copy.unsupportedTitle}</h3>
            <p>{copy.unsupportedBody}</p>
            <p className="mono">{unsupported}</p>
            <div className="row">
              <button type="button" onClick={() => setUnsupported('')}>
                {copy.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

function parseError(text: string): string | undefined {
  try {
    const payload = JSON.parse(text) as { detail?: string }
    return payload.detail
  } catch {
    return undefined
  }
}

const ACTIONS = ['config', 'upload', 'download', 'delete'] as const

function actionLabel(copy: Copy, action: string): string {
  if (action === 'config') return copy.actionConfig
  if (action === 'upload') return copy.actionUpload
  if (action === 'download') return copy.actionDownload
  if (action === 'delete') return copy.actionDelete
  return action
}

export function AuditPage(props: { locale: LocaleFace }) {
  const copy = useCopy(props.locale)
  const active = activeLocale(props.locale)
  const [items, setItems] = useState<AuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [action, setAction] = useState('')
  const [hours, setHours] = useState('')
  const [key, setKey] = useState('')
  const [openId, setOpenId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      if (action !== '') query.set('action', action)
      if (hours !== '') query.set('hours', hours)
      if (key !== '') query.set('key', key)
      const data = await requestJson<{ items: AuditItem[]; total: number }>(`/audit?${query.toString()}`)
      setItems(data.items)
      setTotal(data.total)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [page, pageSize, action, hours])

  return (
    <Panel
      className="smp-list-panel"
      title={copy.auditTitle}
      extra={
        <div className="row smp-plugins-head-extra">
          <input
            className="search"
            type="search"
            placeholder={copy.keyFilter}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setPage(1)
                void load()
              }
            }}
          />
          <button type="button" className="secondary" onClick={() => { setPage(1); void load() }}>
            {copy.refresh}
          </button>
          <select className="smp-status-filter" value={action} onChange={(event) => { setAction(event.target.value); setPage(1) }}>
            <option value="">{copy.allActions}</option>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>
                {actionLabel(copy, value)}
              </option>
            ))}
          </select>
          <select className="smp-status-filter" value={hours} onChange={(event) => { setHours(event.target.value); setPage(1) }}>
            <option value="">{copy.allTime}</option>
            <option value="24">{copy.last24h}</option>
            <option value="168">{copy.last7d}</option>
            <option value="720">{copy.last30d}</option>
          </select>
        </div>
      }
    >
      {error !== '' && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap smp-list-scroll">
        <table className="smp-plugins smp-table">
          <thead>
            <tr>
              <th>{copy.time}</th>
              <th>{copy.actor}</th>
              <th>{copy.action}</th>
              <th>{copy.object}</th>
              <th>{copy.status}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr
                  className={openId === item.id ? 'smp-plugin-row is-open' : 'smp-plugin-row'}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId((current) => (current === item.id ? '' : item.id))}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    setOpenId((current) => (current === item.id ? '' : item.id))
                  }}
                >
                  <td className="nowrap">{formatTime(item.createdAt, active)}</td>
                  <td className="nowrap">{item.actor}</td>
                  <td className="nowrap">{actionLabel(copy, item.action)}</td>
                  <td className="mono smp-cos-key">{item.objectKey === '' ? '—' : item.objectKey}</td>
                  <td className="nowrap">
                    <span className={`pill ${item.ok ? 'succeeded' : 'failed'}`}>{item.ok ? copy.succeeded : copy.failed}</span>
                  </td>
                </tr>
                {openId === item.id && (
                  <tr>
                    <td colSpan={5} className="detail">
                      <dl className="smp-plugin-detail">
                        <dt>{copy.object}</dt>
                        <dd className="mono">{item.objectKey === '' ? '—' : item.objectKey}</dd>
                        <dt>{copy.size}</dt>
                        <dd>{item.sizeBytes === null ? '—' : formatSize(item.sizeBytes, copy)}</dd>
                        <dt>{copy.error}</dt>
                        <dd>{item.error ?? '—'}</dd>
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  {error === '' ? copy.empty : copy.loadFailed}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="smp-plugins-pager smp-list-pager">
        <span className="muted">{copy.total.replace('{count}', String(total))}</span>
        <div className="row">
          <label>
            {copy.perPage}
            <select
              className="smp-page-size"
              aria-label={copy.perPage}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            {copy.previous}
          </button>
          <span>{`${page} / ${Math.max(1, Math.ceil(total / pageSize))}`}</span>
          <button type="button" className="secondary" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)}>
            {copy.next}
          </button>
        </div>
      </div>
    </Panel>
  )
}

interface Draft {
  bucket: string
  region: string
  secretId: string
  secretKey: string
  basePrefix: string
  maxUpload: string
  enabled: boolean
}

const EMPTY: Draft = { bucket: '', region: '', secretId: '', secretKey: '', basePrefix: '', maxUpload: '100', enabled: true }

function toDraft(entry: ConfigEntry | null): Draft {
  if (entry === null) return { ...EMPTY }
  return {
    bucket: entry.bucket,
    region: entry.region,
    secretId: entry.secretId.includes('…') ? '' : entry.secretId,
    secretKey: '',
    basePrefix: entry.basePrefix,
    maxUpload: String(Math.round(entry.maxUploadBytes / 1048576)),
    enabled: entry.enabled,
  }
}

export function SettingsPage(props: { locale: LocaleFace }) {
  const copy = useCopy(props.locale)
  const [attachments, setAttachments] = useState<Draft>({ ...EMPTY })
  const [fallback, setFallback] = useState<Draft>({ ...EMPTY })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState('')

  const loadConfig = async () => {
    setLoading(true)
    try {
      const data = await requestJson<ConfigResponse>('/config')
      setAttachments(toDraft(data.attachments))
      setFallback(toDraft(data.default))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfig()
  }, [])

  const payload = (draft: Draft, role: string) => ({
    role,
    bucket: draft.bucket,
    region: draft.region,
    secretId: draft.secretId,
    secretKey: draft.secretKey,
    basePrefix: draft.basePrefix,
    maxUploadBytes: Math.round(Number(draft.maxUpload || '100') * 1048576),
    enabled: draft.enabled,
  })

  const test = async (role: 'attachments' | 'default', draft: Draft) => {
    setTesting(role)
    setError('')
    setMessage('')
    try {
      await requestJson('/config/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(draft, role)),
      })
      setMessage(`${role}: ${copy.testOk}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTesting('')
    }
  }

  const save = async () => {
    setError('')
    setMessage('')
    try {
      await requestJson('/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attachments: payload(attachments, 'attachments'),
          default: payload(fallback, 'default'),
        }),
      })
      setMessage(copy.saved)
      await loadConfig()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const card = (role: 'attachments' | 'default', title: string, hint: string, draft: Draft, update: (next: Draft) => void) => (
    <section className="panel smp-cos-card">
      <header className="panel-head">
        <h1>
          <i className="mark" />
          {title}
        </h1>
        <button type="button" className="secondary" disabled={testing !== ''} onClick={() => void test(role, draft)}>
          {testing === role ? '…' : copy.test}
        </button>
      </header>
      <div className="panel-body">
        <p className="smp-cos-note">{hint}</p>
        <label className="smp-cos-field">
          <span>{copy.bucket}</span>
          <input value={draft.bucket} onChange={(event) => update({ ...draft, bucket: event.target.value })} placeholder="name-1250000000" />
        </label>
        <label className="smp-cos-field">
          <span>{copy.region}</span>
          <input value={draft.region} onChange={(event) => update({ ...draft, region: event.target.value })} placeholder="ap-beijing" />
        </label>
        <label className="smp-cos-field">
          <span>{copy.secretId}</span>
          <input value={draft.secretId} onChange={(event) => update({ ...draft, secretId: event.target.value })} />
        </label>
        <label className="smp-cos-field">
          <span>{copy.secretKey}</span>
          <input type="password" value={draft.secretKey} placeholder={copy.secretKeyHint} onChange={(event) => update({ ...draft, secretKey: event.target.value })} />
        </label>
        <label className="smp-cos-field">
          <span>{copy.basePrefix}</span>
          <input value={draft.basePrefix} onChange={(event) => update({ ...draft, basePrefix: event.target.value })} placeholder={role === 'attachments' ? 'v1/' : ''} />
        </label>
        {role === 'default' && (
          <label className="smp-cos-field">
            <span>{copy.maxUpload}</span>
            <input type="number" min={1} max={2048} value={draft.maxUpload} onChange={(event) => update({ ...draft, maxUpload: event.target.value })} />
          </label>
        )}
        <label className="smp-cos-check">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ ...draft, enabled: event.target.checked })} />
          <span>enabled</span>
        </label>
      </div>
    </section>
  )

  return (
    <Panel
      title={copy.settingsTitle}
      extra={<button type="button" disabled={loading} onClick={() => void save()}>{copy.save}</button>}
    >
      {message !== '' && <p className="smp-cos-note">{message}</p>}
      {error !== '' && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <div className="smp-cos-cards">
        {card('attachments', copy.attachmentsTitle, copy.attachmentsHint, attachments, setAttachments)}
        {card('default', copy.defaultTitle, copy.requiredBoth, fallback, setFallback)}
      </div>
    </Panel>
  )
}
