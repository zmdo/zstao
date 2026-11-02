import { Fragment, useEffect, useState } from 'react'
import { Dialog, DialogButton } from '@smp/console-kit/dialog'
import { copyFor, type Copy } from './copy.ts'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
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

const API = '/console-api/cos'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { credentials: 'same-origin', ...init })
  const text = await response.text()
  const payload = text === '' ? {} : JSON.parse(text)
  if (!response.ok) {
    const error = new Error((payload as { detail?: string }).detail ?? `HTTP ${response.status}`) as Error & { code?: string }
    error.code = (payload as { code?: string }).code
    throw error
  }
  return payload as T
}

function formatSize(bytes: number | null, copy: Copy): string {
  if (bytes === null) return copy.folders
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatTime(iso: string | null, active: string): string {
  if (iso === null) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(active.startsWith('en') ? 'en-US' : 'zh-CN')
}

export function CosFilesTitle(props: { locale?: LocaleFace }) {
  const active = props.locale?.getSnapshot().active ?? 'zh'
  return <span>{copyFor(active).groupTitle}</span>
}

export function CosFilesBody(props: { locale: LocaleFace; sessionId: string; open(address: string): void }) {
  const active = props.locale.getSnapshot().active
  const copy = copyFor(active)
  const [prefix, setPrefix] = useState('')
  const [items, setItems] = useState<ObjectItem[]>([])
  const [markers, setMarkers] = useState<string[]>([''])
  const [nextMarker, setNextMarker] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unsupported, setUnsupported] = useState('')
  const [opening, setOpening] = useState('')

  const load = async (nextPrefix: string, marker: string) => {
    setLoading(true)
    setError('')
    try {
      const page = await json<ObjectPage>(`/objects?prefix=${encodeURIComponent(nextPrefix)}&marker=${encodeURIComponent(marker)}&limit=100`)
      setItems(page.items)
      setNextMarker(page.nextMarker)
      setPrefix(nextPrefix)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('', '')
  }, [])

  const openFile = async (item: ObjectItem) => {
    if (item.kind === 'folder') {
      setMarkers([''])
      void load(item.key, '')
      return
    }
    setOpening(item.key)
    setError('')
    try {
      const result = await json<{ path: string }>('/materialize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: props.sessionId, key: item.key }),
      })
      const encoded = result.path.split('/').map(encodeURIComponent).join('/')
      props.open(`dsh-resource://file/session/${encodeURIComponent(props.sessionId)}/${encoded}`)
    } catch (cause) {
      const failure = cause as Error & { code?: string }
      if (failure.code === 'unsupported_preview') setUnsupported(item.name)
      else setError(failure.message)
    } finally {
      setOpening('')
    }
  }

  const segments = prefix.split('/').filter((part) => part !== '')
  const crumbs = [{ label: copy.root, prefix: '' }, ...segments.map((part, index) => ({ label: part, prefix: `${segments.slice(0, index + 1).join('/')}/` }))]

  return (
    <div className="smp-cos-sidebar">
      <nav className="smp-cos-crumbs">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.prefix}>
            {index > 0 && <span>/</span>}
            <button type="button" className="smp-cos-crumb" onClick={() => void load(crumb.prefix, '')}>
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
      {loading ? (
        <p className="muted">{copy.loading}</p>
      ) : items.length === 0 ? (
        <p className="empty">{copy.empty}</p>
      ) : (
        <div className="table-wrap smp-list-scroll">
          <table className="smp-plugins smp-table">
            <thead>
              <tr>
                <th>{copy.name}</th>
                <th>{copy.size}</th>
                <th>{copy.updated}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key} className="smp-plugin-row" onClick={() => void openFile(item)}>
                  <td>
                    {item.kind === 'folder' ? (
                      <button
                        type="button"
                        className="smp-cos-folder"
                        onClick={(event) => {
                          event.stopPropagation()
                          void openFile(item)
                        }}
                      >
                        {item.name}/
                      </button>
                    ) : opening === item.key ? (
                      `${item.name} …`
                    ) : (
                      item.name
                    )}
                  </td>
                  <td className="nowrap">{item.kind === 'folder' ? copy.folders : formatSize(item.size, copy)}</td>
                  <td className="nowrap">{formatTime(item.lastModified, active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="smp-plugins-pager smp-list-pager">
        <span className="muted">{`${items.length} ${copy.items}`}</span>        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={markers.length <= 1}
            onClick={() => {
              const next = markers.slice(0, -1)
              setMarkers(next)
              void load(prefix, next[next.length - 1] ?? '')
            }}
          >
            {copy.previous}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={nextMarker === ''}
            onClick={() => {
              setMarkers([...markers, nextMarker])
              void load(prefix, nextMarker)
            }}
          >
            {copy.next}
          </button>
        </div>
      </div>
      {unsupported !== '' && (
        <Dialog
          open
          title={copy.unsupportedTitle}
          closeLabel={copy.close}
          description={copy.unsupportedBody}
          onClose={() => setUnsupported('')}
          footer={
            <DialogButton variant="primary" onClick={() => setUnsupported('')}>
              {copy.close}
            </DialogButton>
          }
        >
          <p className="mono">{unsupported}</p>
        </Dialog>
      )}
    </div>
  )
}
