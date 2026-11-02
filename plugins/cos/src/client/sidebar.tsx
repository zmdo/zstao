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

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function extensionOf(name: string): string {
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
}

const ICON_COLOURS: Record<string, string> = {
  md: '#4f8ef7', txt: '#7a8599', json: '#c9911c', csv: '#2f9e6b',
  ts: '#3178c6', tsx: '#3178c6', js: '#c9a227', jsx: '#c9a227', css: '#b45bd6',
  html: '#d2643c', yaml: '#2f9e6b', yml: '#2f9e6b', sh: '#4f8ef7',
  png: '#2f9e6b', jpg: '#2f9e6b', jpeg: '#2f9e6b', webp: '#2f9e6b', gif: '#2f9e6b',
  pdf: '#d94848',
}

function FileGlyph(props: { name: string }) {
  const colour = ICON_COLOURS[extensionOf(props.name)] ?? 'var(--dsw-alias-label-tertiary)'
  return (
    <svg className="smp-cos-tree-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style={{ color: colour }}>
      <path d="M3.2 1.8h6l3.6 3.6v8.8H3.2Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.2 1.8v3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function FolderGlyph() {
  return (
    <svg className="smp-cos-tree-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M1.8 3.6a1 1 0 0 1 1-1h3l1.3 1.5h6.1a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function CosFilesTitle(props: { locale?: LocaleFace }) {
  const active = props.locale?.getSnapshot().active ?? 'zh'
  return <span>{copyFor(active).sidebarTitle}</span>
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
    <div className="smp-cos-tree">
      <header className="smp-cos-tree-header">
        <nav className="smp-cos-tree-path">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.prefix}>
              {index > 0 && <span className="smp-cos-tree-sep">/</span>}
              <button type="button" className="smp-cos-tree-crumb" onClick={() => void load(crumb.prefix, '')}>
                {crumb.label}
              </button>
            </Fragment>
          ))}
        </nav>
        <button type="button" className="smp-cos-tree-tool" title={copy.refresh} aria-label={copy.refresh} onClick={() => void load(prefix, '')}>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V6h-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <div className="smp-cos-tree-body">
        {error !== '' && (
          <p className="smp-cos-tree-status" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="smp-cos-tree-status">{copy.loading}</p>
        ) : items.length === 0 ? (
          <p className="smp-cos-tree-status">{copy.empty}</p>
        ) : (
          <ul className="smp-cos-tree-level">
            {items.map((item) => (
              <li key={item.key} className="smp-cos-tree-item">
                <button type="button" className="smp-cos-tree-row" disabled={opening === item.key} onClick={() => void openFile(item)}>
                  {item.kind === 'folder' ? <FolderGlyph /> : <FileGlyph name={item.name} />}
                  <span className="smp-cos-tree-name">{item.name}</span>
                  {item.kind === 'file' && <span className="smp-cos-tree-meta">{formatSize(item.size)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="smp-cos-tree-footer">
        <span>{`${items.length} ${copy.items}`}</span>
        <div className="row">
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
      </footer>
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
