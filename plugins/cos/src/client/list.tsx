import { Fragment, useEffect, useState } from 'react'
import { FileTypeIcon, FolderIcon } from './icons.tsx'
import { copyFor } from './copy.ts'
import type { TreeItem } from './tree.tsx'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface ObjectPage {
  items: TreeItem[]
  nextMarker: string
  truncated: boolean
}

interface Props {
  locale: LocaleFace
  search?: string
  refreshKey?: number
  onOpen(item: TreeItem): void
  onDownload?(item: TreeItem): void
  onDelete?(item: TreeItem): void
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatTime(iso: string | null, active: string): string {
  if (iso === null) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(active.startsWith('en') ? 'en-US' : 'zh-CN')
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`/console-api/cos${path}`, { credentials: 'same-origin' })
  const text = await response.text()
  const payload = text === '' ? {} : JSON.parse(text)
  if (!response.ok) throw new Error((payload as { detail?: string }).detail ?? `HTTP ${response.status}`)
  return payload as T
}

export function CosList(props: Props) {
  const active = props.locale.getSnapshot().active
  const copy = copyFor(active)
  const [prefix, setPrefix] = useState('')
  const [items, setItems] = useState<TreeItem[]>([])
  const [markers, setMarkers] = useState<string[]>([''])
  const [nextMarker, setNextMarker] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [results, setResults] = useState<TreeItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const query = (props.search ?? '').trim()

  const load = async (nextPrefix: string, marker: string) => {
    setLoading(true)
    setError('')
    try {
      const page = await json<ObjectPage>(`/objects?prefix=${encodeURIComponent(nextPrefix)}&marker=${encodeURIComponent(marker)}&limit=100`)
      setItems(page.items)
      setNextMarker(page.nextMarker)
      setPrefix(nextPrefix)
      setMarkers((current) => (marker === '' ? [''] : current.length === 0 ? ['', marker] : current))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setMarkers([''])
    void load('', '')
  }, [props.refreshKey])

  useEffect(() => {
    if (query === '') {
      setResults([])
      setSearchError('')
      return
    }
    setSearching(true)
    setSearchError('')
    void json<ObjectPage>(`/objects?prefix=&marker=&limit=100&search=${encodeURIComponent(query)}`)
      .then((page) => setResults(page.items.filter((item) => item.kind === 'file')))
      .catch((cause: unknown) => setSearchError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSearching(false))
  }, [query, props.refreshKey])

  const row = (item: TreeItem) => (
    <div
      key={item.key}
      className="smp-cos-tree-row"
      role="button"
      tabIndex={0}
      onClick={() => (item.kind === 'folder' ? void load(item.key, '') : props.onOpen(item))}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (item.kind === 'folder') void load(item.key, '')
        else props.onOpen(item)
      }}
    >
      {item.kind === 'folder' ? <FolderIcon size={16} /> : <FileTypeIcon name={item.name} size={16} />}
      <span className="smp-cos-tree-name">{item.name}{item.kind === 'folder' ? '/' : ''}</span>
      {item.kind === 'file' && <span className="smp-cos-tree-meta">{formatSize(item.size)}</span>}
      {item.kind === 'file' && <span className="smp-cos-tree-time">{formatTime(item.lastModified, active)}</span>}
      {(props.onDownload !== undefined || props.onDelete !== undefined) && item.kind === 'file' && (
        <span className="smp-cos-tree-actions" onClick={(event) => event.stopPropagation()}>
          {props.onDownload !== undefined && (
            <button type="button" className="secondary" onClick={() => props.onDownload?.(item)}>
              {copy.download}
            </button>
          )}
          {props.onDelete !== undefined && (
            <button type="button" className="secondary" onClick={() => props.onDelete?.(item)}>
              {copy.delete}
            </button>
          )}
        </span>
      )}
    </div>
  )

  if (query !== '') {
    if (searching) return <p className="smp-cos-tree-status">{copy.loading}</p>
    if (searchError !== '') return <p className="smp-cos-tree-status">{searchError}</p>
    if (results.length === 0) return <p className="smp-cos-tree-status">{copy.empty}</p>
    return <div className="smp-cos-list">{results.map((item) => row(item))}</div>
  }

  const segments = prefix.split('/').filter((part) => part !== '')
  const crumbs = [{ label: copy.root, prefix: '' }, ...segments.map((part, index) => ({ label: part, prefix: `${segments.slice(0, index + 1).join('/')}/` }))]

  return (
    <div className="smp-cos-list">
      <nav className="smp-cos-crumbs">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.prefix}>
            {index > 0 && <span className="smp-cos-crumb-sep">/</span>}
            <button type="button" className="smp-cos-crumb" onClick={() => { setMarkers(['']); void load(crumb.prefix, '') }}>
              {crumb.label}
            </button>
          </Fragment>
        ))}
      </nav>
      {error !== '' && <p className="smp-cos-tree-status">{error}</p>}
      {loading ? (
        <p className="smp-cos-tree-status">{copy.loading}</p>
      ) : items.length === 0 ? (
        <p className="smp-cos-tree-status">{copy.empty}</p>
      ) : (
        <div className="smp-cos-tree-level">{items.map((item) => row(item))}</div>
      )}
      <div className="smp-cos-pager">
        <span>{items.length} {copy.items}</span>
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
              setMarkers((current) => [...current, nextMarker])
              void load(prefix, nextMarker)
            }}
          >
            {copy.next}
          </button>
        </div>
      </div>
    </div>
  )
}
