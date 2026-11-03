import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DirectoryListing, GroupClient } from './client-api.ts'
import { pickerGroup } from './picker-controller.ts'
import { UNASSIGNED_GROUP_ID } from './rules.ts'

export interface DirectoryFlowProps {
  open: boolean
  busy: boolean
  onPicked(path: string): void
  onCancel(): void
  onError(message: string): void
}

interface NodeState {
  path: string
  name: string
  expanded: boolean
  children?: string[]
  loading?: boolean
}

const PICKER_STYLE = `
.smp-wg-picker-mask{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:rgb(15 23 42 / 38%)}
.smp-wg-picker{display:flex;flex-direction:column;width:min(900px,94vw);height:min(580px,86vh);overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgb(15 23 42 / 24%);color:var(--dsw-alias-label-primary)}
.smp-wg-picker-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-bottom:1px solid var(--line)}
.smp-wg-picker-title{margin:0;font-size:14px;font-weight:600}
.smp-wg-picker-close{width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:20px;line-height:1;cursor:pointer}
.smp-wg-picker-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.smp-wg-picker-crumbs{display:flex;align-items:center;gap:2px;min-height:38px;padding:0 16px;overflow-x:auto;border-bottom:1px solid var(--line);white-space:nowrap}
.smp-wg-picker-crumb{border:0;background:transparent;color:var(--muted);padding:4px 6px;border-radius:5px;font-size:12px;cursor:pointer}
.smp-wg-picker-crumb:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.smp-wg-picker-crumb.is-current{color:var(--dsw-alias-label-primary);font-weight:600}
.smp-wg-picker-crumb-sep{color:var(--dsw-alias-label-tertiary);font-size:11px}
.smp-wg-picker-body{display:grid;grid-template-columns:270px minmax(0,1fr);flex:1;min-height:0}
.smp-wg-picker-tree{min-height:0;overflow:auto;padding:8px;border-right:1px solid var(--line);background:var(--dsw-alias-bg-layer-2)}
.smp-wg-picker-tree-row{display:flex;align-items:center;width:100%;min-width:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);padding:5px 6px;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.smp-wg-picker-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.smp-wg-picker-tree-row.is-current{background:var(--dsw-alias-interactive-bg-selected, rgb(37 99 235 / 12%));color:var(--accent, #2563eb)}
.smp-wg-picker-chevron{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none;border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:11px}
.smp-wg-picker-chevron.is-empty{visibility:hidden}
.smp-wg-picker-folder-icon{width:16px;flex:none;text-align:center;color:var(--accent, #2563eb);font-size:12px}
.smp-wg-picker-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smp-wg-picker-content{display:flex;flex-direction:column;min-width:0;min-height:0}
.smp-wg-picker-list{flex:1;min-height:0;overflow:auto;padding:8px}
.smp-wg-picker-row{display:flex;align-items:center;gap:10px;width:100%;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);padding:9px 10px;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.smp-wg-picker-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.smp-wg-picker-row.is-hidden{opacity:.55}
.smp-wg-picker-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smp-wg-picker-row-enter{margin-left:auto;color:var(--muted);font-size:11px}
.smp-wg-picker-empty{display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--muted);font-size:12px}
.smp-wg-picker-error{margin:10px;padding:8px 10px;border:1px solid rgb(239 68 68 / 35%);border-radius:6px;color:var(--dsw-alias-label-error, #dc2626);background:rgb(239 68 68 / 7%);font-size:12px;line-height:1.5}
.smp-wg-picker-loading{display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--muted);font-size:12px}
.smp-wg-picker-foot{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--line)}
.smp-wg-picker-path{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.smp-wg-picker-btn{border:1px solid var(--line);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}
.smp-wg-picker-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.smp-wg-picker-btn:disabled{opacity:.5;cursor:default}
.smp-wg-picker-btn.is-primary{border-color:var(--accent, #2563eb);background:var(--accent, #2563eb);color:#fff}
.smp-wg-picker-btn.is-primary:hover:not(:disabled){filter:brightness(1.08)}
.smp-wg-picker-new{display:flex;align-items:center;gap:6px}
.smp-wg-picker-new input{width:150px;box-sizing:border-box;border:1px solid var(--line);border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:inherit;padding:5px 7px;font:inherit;font-size:12px}
@media (max-width:720px){
  .smp-wg-picker-mask{padding:10px}
  .smp-wg-picker{width:100%;height:min(680px,94vh)}
  .smp-wg-picker-body{grid-template-columns:1fr;grid-template-rows:minmax(100px,28%) minmax(0,1fr)}
  .smp-wg-picker-tree{border-right:0;border-bottom:1px solid var(--line)}
}
`

const COPY = {
  zh: {
    title: '选择工作区目录',
    empty: '这个目录下没有子目录',
    loading: '正在读取目录…',
    cancel: '取消',
    pick: '选择当前目录',
    create: '新建文件夹',
    createOk: '创建',
    createCancel: '取消',
    newPlaceholder: '文件夹名称',
    noGroup: '当前工作区组没有可用目录',
    up: '上一级',
  },
  en: {
    title: 'Select workspace directory',
    empty: 'No subdirectories',
    loading: 'Loading directory…',
    cancel: 'Cancel',
    pick: 'Use this directory',
    create: 'New folder',
    createOk: 'Create',
    createCancel: 'Cancel',
    newPlaceholder: 'Folder name',
    noGroup: 'This workspace group has no available directory',
    up: 'Up',
  },
} as const

function baseName(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

function parentPath(path: string): string {
  const value = path.replace(/\/+$/, '')
  const index = value.lastIndexOf('/')
  return index <= 0 ? '/' : value.slice(0, index)
}

function messageOf(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'rpcError' in cause) {
    const rpc = (cause as { rpcError?: { message?: unknown } }).rpcError
    if (typeof rpc?.message === 'string' && rpc.message !== '') return rpc.message
  }
  return cause instanceof Error ? cause.message : String(cause)
}

function startPath(client: GroupClient): string | undefined {
  const snapshot = client.getSnapshot()
  const groupId = pickerGroup(client) ?? client.selectedId()
  if (groupId === undefined || groupId === UNASSIGNED_GROUP_ID) return undefined
  const group = snapshot.groups.find(item => item.kind === 'normal' && item.id === groupId)
  const member = snapshot.members.find(item => item.groupId === groupId && item.isDefault)
  return member === undefined ? group?.path : parentPath(member.directory)
}

export function DirectoryTreeFlow(props: DirectoryFlowProps & { client: GroupClient }) {
  const { client, open, busy } = props
  const copy = COPY[client.ctx.locale.getSnapshot().active === 'en' ? 'en' : 'zh']
  const [root, setRoot] = useState('')
  const [current, setCurrent] = useState('')
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [listing, setListing] = useState<DirectoryListing>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const nodesRef = useRef<Record<string, NodeState>>({})
  const currentRef = useRef('')
  const requestRef = useRef<AbortController>()

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { currentRef.current = current }, [current])

  const setNode = (path: string, update: Partial<NodeState>) => {
    const next = { ...nodesRef.current }
    next[path] = { ...(next[path] ?? { path, name: baseName(path), expanded: false }), ...update }
    nodesRef.current = next
    setNodes(next)
  }

  const load = async (path: string, options: { select?: boolean } = {}) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await client.ctx.uiWorkspace.listDirectory(path, controller.signal)
      if (controller.signal.aborted) return
      const next = { ...nodesRef.current }
      const children = result.entries.map(entry => entry.path)
      next[path] = { ...(next[path] ?? { path, name: baseName(path), expanded: false }), path, name: baseName(path), expanded: true, children, loading: false }
      for (const entry of result.entries) {
        if (next[entry.path] === undefined) next[entry.path] = { path: entry.path, name: entry.name, expanded: false }
      }
      nodesRef.current = next
      setNodes(next)
      if (options.select === true || path === currentRef.current) {
        if (options.select === true) {
          currentRef.current = path
          setCurrent(path)
        }
        setListing(result)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const reveal = async (path: string) => {
    let cursor = path
    const chain: string[] = []
    while (cursor.length > root.length && cursor.startsWith(`${root}/`)) {
      cursor = parentPath(cursor)
      chain.unshift(cursor)
    }
    for (const item of chain) {
      if (nodesRef.current[item]?.children === undefined) await load(item)
      setNode(item, { expanded: true })
    }
  }

  const enter = async (path: string) => {
    currentRef.current = path
    setCurrent(path)
    await reveal(path)
    await load(path, { select: true })
  }

  useEffect(() => {
    if (!open) {
      requestRef.current?.abort()
      return
    }
    const start = startPath(client)
    setCreating(false)
    setNewName('')
    setSubmitting(false)
    setError('')
    setListing(undefined)
    if (start === undefined) {
      setRoot('')
      setCurrent('')
      nodesRef.current = {}
      setNodes({})
      setError(copy.noGroup)
      return
    }
    const node: NodeState = { path: start, name: baseName(start), expanded: true }
    setRoot(start)
    currentRef.current = start
    setCurrent(start)
    nodesRef.current = { [start]: node }
    setNodes({ [start]: node })
    void load(start, { select: true })
    return () => requestRef.current?.abort()
  }, [open, client])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !submitting) props.onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, submitting, props.onCancel])

  if (!open) return null

  const breadcrumbs = listing?.crumbs ?? []
  const rows = listing?.entries ?? []
  const disabled = busy || submitting || loading

  const toggle = async (path: string) => {
    const node = nodesRef.current[path]
    if (node?.expanded === true) {
      setNode(path, { expanded: false })
      return
    }
    if (node?.children === undefined) await load(path)
    else setNode(path, { expanded: true })
  }

  const createFolder = async () => {
    const name = newName.trim()
    if (name === '') return
    setCreating(false)
    setError('')
    setSubmitting(true)
    try {
      const created = await client.ctx.uiWorkspace.createDirectory(currentRef.current, name)
      setNewName('')
      await load(created, { select: true })
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const pick = () => {
    if (currentRef.current === '' || disabled) return
    setSubmitting(true)
    props.onPicked(currentRef.current)
  }

  const treeRow = (path: string, depth: number): ReactNode => {
    const node = nodesRef.current[path]
    if (node === undefined) return null
    const expandable = node.children === undefined || node.children.length > 0
    return (
      <div key={path}>
        <button
          type="button"
          className={`smp-wg-picker-tree-row${path === current ? ' is-current' : ''}`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          title={path}
          onClick={() => { void enter(path) }}
        >
          <span
            className={`smp-wg-picker-chevron${expandable ? '' : ' is-empty'}`}
            role="button"
            aria-label={node.expanded ? 'collapse' : 'expand'}
            onClick={(event) => { event.stopPropagation(); void toggle(path) }}
          >
            {node.expanded ? '▾' : '▸'}
          </span>
          <span className="smp-wg-picker-folder-icon">▱</span>
          <span className="smp-wg-picker-tree-name">{node.name}</span>
        </button>
        {node.expanded && node.children?.map(child => treeRow(child, depth + 1))}
      </div>
    )
  }

  return createPortal(
    <>
      <style>{PICKER_STYLE}</style>
      <div className="smp-wg-picker-mask" onMouseDown={() => { if (!busy && !submitting) props.onCancel() }}>
        <div className="smp-wg-picker" role="dialog" aria-modal="true" aria-label={copy.title} onMouseDown={event => event.stopPropagation()}>
          <header className="smp-wg-picker-head">
            <h2 className="smp-wg-picker-title">{copy.title}</h2>
            <button type="button" className="smp-wg-picker-close" aria-label={copy.cancel} onClick={() => { if (!busy && !submitting) props.onCancel() }}>×</button>
          </header>
          <nav className="smp-wg-picker-crumbs" aria-label="path">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.path} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {index > 0 && <span className="smp-wg-picker-crumb-sep">/</span>}
                <button
                  type="button"
                  className={`smp-wg-picker-crumb${crumb.path === current ? ' is-current' : ''}`}
                  onClick={() => { void enter(crumb.path) }}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
          <div className="smp-wg-picker-body">
            <aside className="smp-wg-picker-tree" aria-label="directories">
              {root !== '' && treeRow(root, 0)}
            </aside>
            <section className="smp-wg-picker-content">
              {error !== '' && <div className="smp-wg-picker-error">{error}</div>}
              {loading && rows.length === 0 ? <div className="smp-wg-picker-loading">{copy.loading}</div> : null}
              <div className="smp-wg-picker-list">
                {!loading && error === '' && rows.length === 0 ? <div className="smp-wg-picker-empty">{copy.empty}</div> : null}
                {rows.map(entry => (
                  <button
                    key={entry.path}
                    type="button"
                    className={`smp-wg-picker-row${entry.hidden ? ' is-hidden' : ''}`}
                    title={entry.path}
                    onClick={() => { void enter(entry.path) }}
                  >
                    <span className="smp-wg-picker-folder-icon">▱</span>
                    <span className="smp-wg-picker-row-name">{entry.name}</span>
                    <span className="smp-wg-picker-row-enter">›</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
          <footer className="smp-wg-picker-foot">
            <span className="smp-wg-picker-path" title={current}>{current}</span>
            {creating ? (
              <span className="smp-wg-picker-new">
                <input
                  autoFocus
                  value={newName}
                  placeholder={copy.newPlaceholder}
                  onChange={event => setNewName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') void createFolder()
                    if (event.key === 'Escape') { event.stopPropagation(); setCreating(false); setNewName('') }
                  }}
                />
                <button type="button" className="smp-wg-picker-btn" onClick={() => { void createFolder() }} disabled={newName.trim() === '' || submitting}>{copy.createOk}</button>
                <button type="button" className="smp-wg-picker-btn" onClick={() => { setCreating(false); setNewName('') }}>{copy.createCancel}</button>
              </span>
            ) : (
              <button type="button" className="smp-wg-picker-btn" onClick={() => setCreating(true)} disabled={disabled}>{copy.create}</button>
            )}
            <button type="button" className="smp-wg-picker-btn" onClick={() => { if (!busy && !submitting) props.onCancel() }} disabled={busy || submitting}>{copy.cancel}</button>
            <button type="button" className="smp-wg-picker-btn is-primary" onClick={pick} disabled={disabled || current === ''}>{copy.pick}</button>
          </footer>
        </div>
      </div>
    </>,
    document.body,
  )
}
