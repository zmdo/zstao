import { useEffect, useState } from 'react'
import { Dialog, DialogButton } from '@smp/console-kit/dialog'
import { FileTypeIcon, FolderIcon } from './icons.tsx'
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

interface Level {
  items: ObjectItem[]
  nextMarker: string
  loading: boolean
  error: string
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

export function CosFilesTitle(props: { locale?: LocaleFace }) {
  const active = props.locale?.getSnapshot().active ?? 'zh'
  return (
    <>
      <FolderIcon size={16} className="smp-cos-title-icon" />
      <span>{copyFor(active).sidebarTitle}</span>
    </>
  )
}

export function CosFilesBody(props: { locale: LocaleFace; sessionId: string; open(address: string): void }) {
  const copy: Copy = copyFor(props.locale.getSnapshot().active)
  const [levels, setLevels] = useState<Record<string, Level>>({})
  const [expanded, setExpanded] = useState<string[]>([])
  const [unsupported, setUnsupported] = useState('')
  const [opening, setOpening] = useState('')

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
    void loadLevel('')
  }, [])

  const toggle = (key: string) => {
    setExpanded((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]))
    if (levels[key] === undefined) void loadLevel(key)
  }

  const openFile = async (item: ObjectItem) => {
    setOpening(item.key)
    patch('', { error: '' })
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
      else patch('', { error: failure.message })
    } finally {
      setOpening('')
    }
  }

  const renderLevel = (prefix: string, depth: number) => {
    const level = levels[prefix]
    if (level === undefined || (level.loading && level.items.length === 0)) {
      return <p className="smp-cos-tree-status">{copy.loading}</p>
    }
    if (level.error !== '') return <p className="smp-cos-tree-status">{level.error}</p>
    if (level.items.length === 0) return <p className="smp-cos-tree-status">{copy.empty}</p>
    return (
      <ul className="smp-cos-tree-level">
        {level.items.map((item) => {
          const isOpen = item.kind === 'folder' && expanded.includes(item.key)
          return (
            <li key={item.key} className="smp-cos-tree-item">
              <button
                type="button"
                className="smp-cos-tree-row"
                style={{ paddingLeft: 10 + depth * 18 }}
                disabled={opening === item.key}
                onClick={() => (item.kind === 'folder' ? toggle(item.key) : void openFile(item))}
              >
                {item.kind === 'folder' ? <FolderIcon open={isOpen} size={16} /> : <FileTypeIcon name={item.name} size={16} />}
                <span className="smp-cos-tree-name">{item.name}</span>
                {item.kind === 'file' && <span className="smp-cos-tree-meta">{formatSize(item.size)}</span>}
              </button>
              {isOpen && renderLevel(item.key, depth + 1)}
            </li>
          )
        })}
        {level.nextMarker !== '' && (
          <li className="smp-cos-tree-item">
            <button type="button" className="smp-cos-tree-more" style={{ paddingLeft: 10 + depth * 18 }} onClick={() => void loadLevel(prefix, level.nextMarker, true)}>
              {copy.loadMore}
            </button>
          </li>
        )}
      </ul>
    )
  }

  return (
    <div className="smp-cos-tree">
      <header className="smp-cos-tree-header">
        <span className="smp-cos-tree-root">{copy.root}</span>
        <button
          type="button"
          className="smp-cos-tree-tool"
          title={copy.refresh}
          aria-label={copy.refresh}
          onClick={() => {
            setLevels({})
            setExpanded([])
            void loadLevel('')
          }}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V6h-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <div className="smp-cos-tree-body">{renderLevel('', 0)}</div>
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
