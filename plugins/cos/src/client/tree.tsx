import { useEffect, useState } from 'react'
import { FileTypeIcon, FolderIcon } from './icons.tsx'
import { copyFor } from './copy.ts'

export interface TreeItem {
  kind: 'folder' | 'file'
  key: string
  name: string
  size: number | null
  lastModified: string | null
}

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface ObjectPage {
  items: TreeItem[]
  nextMarker: string
  truncated: boolean
}

interface Level {
  items: TreeItem[]
  nextMarker: string
  loading: boolean
  error: string
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

export function CosTree(props: Props) {
  const active = props.locale.getSnapshot().active
  const copy = copyFor(active)
  const [levels, setLevels] = useState<Record<string, Level>>({})
  const [expanded, setExpanded] = useState<string[]>([])
  const [results, setResults] = useState<TreeItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const query = (props.search ?? '').trim()

  const patch = (prefix: string, next: Partial<Level>) =>
    setLevels((state) => ({ ...state, [prefix]: { items: [], nextMarker: '', loading: false, error: '', ...state[prefix], ...next } }))

  const loadLevel = async (prefix: string, marker = '', append = false) => {
    patch(prefix, { loading: true, error: '' })
    try {
      const page = await json<ObjectPage>(`/objects?prefix=${encodeURIComponent(prefix)}&marker=${encodeURIComponent(marker)}&limit=100`)
      setLevels((state) => {
        const current = state[prefix] ?? { items: [], nextMarker: '', loading: false, error: '' }
        return {
          ...state,
          [prefix]: {
            items: append ? [...current.items, ...page.items] : page.items,
            nextMarker: page.nextMarker,
            loading: false,
            error: '',
          },
        }
      })
    } catch (cause) {
      patch(prefix, { loading: false, error: cause instanceof Error ? cause.message : String(cause), items: [] })
    }
  }

  useEffect(() => {
    setLevels({})
    setExpanded([])
    void loadLevel('')
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

  const toggle = (key: string) => {
    setExpanded((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]))
    if (levels[key] === undefined) void loadLevel(key)
  }

  const row = (item: TreeItem, depth: number, isOpen: boolean) => (
    <div
      key={item.key}
      className="smp-cos-tree-row"
      role="button"
      tabIndex={0}
      style={{ paddingLeft: 10 + depth * 18 }}
      onClick={() => (item.kind === 'folder' ? toggle(item.key) : props.onOpen(item))}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (item.kind === 'folder') toggle(item.key)
        else props.onOpen(item)
      }}
    >
      {item.kind === 'folder' ? <FolderIcon open={isOpen} size={16} /> : <FileTypeIcon name={item.name} size={16} />}
      <span className="smp-cos-tree-name">{item.name}</span>
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

  const renderLevel = (prefix: string, depth: number) => {
    const level = levels[prefix]
    if (level === undefined || (level.loading && level.items.length === 0)) return <p className="smp-cos-tree-status">{copy.loading}</p>
    if (level.error !== '') return <p className="smp-cos-tree-status">{level.error}</p>
    if (level.items.length === 0) return <p className="smp-cos-tree-status">{copy.empty}</p>
    return (
      <div className="smp-cos-tree-level">
        {level.items.map((item) => (
          <div key={item.key} className="smp-cos-tree-item">
            {row(item, depth, item.kind === 'folder' && expanded.includes(item.key))}
            {item.kind === 'folder' && expanded.includes(item.key) && renderLevel(item.key, depth + 1)}
          </div>
        ))}
        {level.nextMarker !== '' && (
          <button type="button" className="smp-cos-tree-more" style={{ paddingLeft: 10 + depth * 18 }} onClick={() => void loadLevel(prefix, level.nextMarker, true)}>
            {copy.loadMore}
          </button>
        )}
      </div>
    )
  }

  if (query !== '') {
    if (searching) return <p className="smp-cos-tree-status">{copy.loading}</p>
    if (searchError !== '') return <p className="smp-cos-tree-status">{searchError}</p>
    if (results.length === 0) return <p className="smp-cos-tree-status">{copy.empty}</p>
    return <div className="smp-cos-tree-level">{results.map((item) => row(item, 0, false))}</div>
  }

  return <>{renderLevel('', 0)}</>
}
