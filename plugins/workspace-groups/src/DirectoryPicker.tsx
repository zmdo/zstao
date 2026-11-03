import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DirectoryListing, GroupClient } from './client-api.ts'
import type { GroupSnapshot, NormalGroup } from './contract.ts'
import { pickerGroup } from './picker-controller.ts'
import { UNASSIGNED_GROUP_ID } from './rules.ts'

export interface DirectoryFlowProps {
  open: boolean
  busy: boolean
  onPicked(path: string): void
  onCancel(): void
  onError(message: string): void
}

interface ColumnState {
  path: string
  listing?: DirectoryListing
  loading: boolean
  error?: string
}

const PICKER_STYLE = `
.smp-wg-picker-mask{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:rgb(15 23 42 / 38%)}
.smp-wg-picker{display:flex;flex-direction:column;width:min(1080px,94vw);height:min(660px,88vh);overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 24px 80px rgb(15 23 42 / 24%);color:var(--dsw-alias-label-primary,#1f2937)}
.smp-wg-picker-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 16px;border-bottom:1px solid var(--line);background:var(--dsw-alias-bg-layer-1,#fff)}
.smp-wg-picker-title{margin:0;font-size:14px;font-weight:600}
.smp-wg-picker-close{width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:20px;line-height:1;cursor:pointer}
.smp-wg-picker-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.smp-wg-picker-body{display:flex;flex:1;min-height:0}
.smp-wg-picker-rail{display:flex;flex-direction:column;width:210px;flex:none;min-height:0;border-right:1px solid var(--line);background:var(--dsw-alias-bg-layer-2,#f5f5f7)}
.smp-wg-picker-rail-head{padding:12px 14px 7px;color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.02em}
.smp-wg-picker-rail-list{min-height:0;overflow:auto;padding:0 8px 10px}
.smp-wg-picker-group{display:flex;align-items:center;gap:8px;width:100%;min-width:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary,#1f2937);padding:7px 9px;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.smp-wg-picker-group:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 5%))}
.smp-wg-picker-group.is-current{background:var(--dsw-alias-interactive-bg-selected,rgb(37 99 235 / 12%));color:var(--accent,#2563eb)}
.smp-wg-picker-group-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smp-wg-picker-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff)}
.smp-wg-picker-toolbar{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-bottom:1px solid var(--line);background:var(--dsw-alias-bg-layer-2,#fafafa)}
.smp-wg-picker-nav{width:26px;height:26px;flex:none;border:1px solid var(--line);border-radius:5px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2937);font-size:14px;line-height:1;cursor:pointer}
.smp-wg-picker-nav:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.smp-wg-picker-nav:disabled{opacity:.35;cursor:default}
.smp-wg-picker-crumbs{display:flex;align-items:center;gap:1px;flex:1;min-width:0;overflow-x:auto;white-space:nowrap;padding:0 4px}
.smp-wg-picker-crumb{border:0;background:transparent;color:var(--muted);padding:4px 5px;border-radius:4px;font:inherit;font-size:12px;cursor:pointer}
.smp-wg-picker-crumb:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.smp-wg-picker-crumb.is-current{color:var(--dsw-alias-label-primary);font-weight:600}
.smp-wg-picker-crumb-sep{color:var(--dsw-alias-label-tertiary);font-size:11px}
.smp-wg-picker-hidden{display:inline-flex;align-items:center;gap:5px;flex:none;color:var(--muted);font-size:11px;cursor:pointer;user-select:none}
.smp-wg-picker-hidden input{margin:0}
.smp-wg-picker-columns{display:flex;flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-layer-2,#f5f5f7)}
.smp-wg-picker-column{width:252px;flex:none;min-height:0;overflow:auto;border-right:1px solid var(--dsw-alias-border-l3,var(--line,#e5e7eb));background:var(--dsw-alias-bg-layer-1,#fff)}
.smp-wg-picker-column:nth-child(even){background:var(--dsw-alias-bg-layer-2,#fafafa)}
.smp-wg-picker-column:last-child{border-right:0}
.smp-wg-picker-column-inner{padding:7px}
.smp-wg-picker-column-empty{display:flex;align-items:center;justify-content:center;min-height:120px;padding:14px;color:var(--muted);font-size:12px;text-align:center}
.smp-wg-picker-column-error{margin:7px;padding:8px;border:1px solid rgb(239 68 68 / 35%);border-radius:6px;color:var(--dsw-alias-label-error,#dc2626);background:rgb(239 68 68 / 7%);font-size:12px;line-height:1.5}
.smp-wg-picker-column-loading{display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--muted);font-size:12px}
.smp-wg-picker-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#1f2937);padding:7px 8px;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.smp-wg-picker-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 5%))}
.smp-wg-picker-row.is-current{background:var(--dsw-alias-interactive-bg-selected,rgb(37 99 235 / 12%));color:var(--accent,#2563eb)}
.smp-wg-picker-row.is-hidden{opacity:.55}
.smp-wg-picker-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.smp-wg-picker-row-enter{margin-left:auto;color:var(--muted);font-size:12px}
.smp-wg-picker-folder{width:16px;height:16px;flex:none;color:var(--accent,#2563eb)}
.smp-wg-picker-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid var(--line);background:var(--dsw-alias-bg-layer-2,#fafafa)}
.smp-wg-picker-foot-group{display:flex;align-items:center;gap:8px;min-width:0}
.smp-wg-picker-foot-group.is-right{flex:none}
.smp-wg-picker-btn{border:1px solid var(--line);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2937);padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}
.smp-wg-picker-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.smp-wg-picker-btn:disabled{opacity:.5;cursor:default}
.smp-wg-picker-btn.is-primary{border-color:var(--accent,#2563eb);background:var(--accent,#2563eb);color:#fff}
.smp-wg-picker-btn.is-primary:hover:not(:disabled){filter:brightness(1.08)}
.smp-wg-picker-new{display:flex;align-items:center;gap:6px}
.smp-wg-picker-new input{width:150px;box-sizing:border-box;border:1px solid var(--line);border-radius:5px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;padding:5px 7px;font:inherit;font-size:12px}
.smp-wg-picker-global-error{margin:10px 12px 0;padding:8px 10px;border:1px solid rgb(239 68 68 / 35%);border-radius:6px;color:var(--dsw-alias-label-error,#dc2626);background:rgb(239 68 68 / 7%);font-size:12px}
@media (max-width:760px){
  .smp-wg-picker-mask{padding:10px}
  .smp-wg-picker{width:100%;height:min(720px,94vh)}
  .smp-wg-picker-rail{width:160px}
  .smp-wg-picker-column{width:230px}
  .smp-wg-picker-hidden{display:none}
}
`

const COPY = {
  zh: {
    title: '选择工作区目录',
    groups: '工作区组',
    empty: '这个目录下没有子目录',
    loading: '正在读取目录…',
    cancel: '取消',
    pick: '选择当前目录',
    create: '新建文件夹',
    createOk: '创建',
    createCancel: '取消',
    newPlaceholder: '文件夹名称',
    noGroup: '没有可用的工作区组',
    hidden: '显示隐藏文件',
    back: '后退',
    forward: '前进',
  },
  en: {
    title: 'Select workspace directory',
    groups: 'Workspace groups',
    empty: 'No subdirectories',
    loading: 'Loading directory…',
    cancel: 'Cancel',
    pick: 'Use this directory',
    create: 'New folder',
    createOk: 'Create',
    createCancel: 'Cancel',
    newPlaceholder: 'Folder name',
    noGroup: 'No workspace groups available',
    hidden: 'Show hidden files',
    back: 'Back',
    forward: 'Forward',
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

function normalGroups(snapshot: GroupSnapshot): NormalGroup[] {
  return snapshot.groups.filter((group): group is NormalGroup => group.kind === 'normal')
}

function startPath(group: NormalGroup, snapshot: GroupSnapshot): string {
  const member = snapshot.members.find(item => item.groupId === group.id && item.isDefault)
  return member === undefined ? group.path : parentPath(member.directory)
}

function FolderIcon() {
  return (
    <svg className="smp-wg-picker-folder" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.8 4.3c0-.72.58-1.3 1.3-1.3h2.25c.35 0 .68.14.93.39l.9.9c.12.12.28.19.45.19h4.77c.72 0 1.3.58 1.3 1.3v6.5c0 .72-.58 1.3-1.3 1.3H3.1c-.72 0-1.3-.58-1.3-1.3V4.3Z" fill="currentColor" opacity=".18" />
      <path d="M2.35 4.35c0-.4.32-.72.72-.72h2.25c.19 0 .37.08.5.21l.9.9c.3.3.7.47 1.12.47h4.6c.4 0 .72.32.72.72v6.2c0 .4-.32.72-.72.72H3.07a.72.72 0 0 1-.72-.72v-7.78Z" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

export function DirectoryTreeFlow(props: DirectoryFlowProps & { client: GroupClient }) {
  const { client, open, busy } = props
  const copy = COPY[client.ctx.locale.getSnapshot().active === 'en' ? 'en' : 'zh']
  useSyncExternalStore(client.subscribe, client.store.getRevision)
  const [groupId, setGroupId] = useState('')
  const [columns, setColumns] = useState<ColumnState[]>([])
  const [history, setHistory] = useState<string[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [showHidden, setShowHidden] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const columnsRef = useRef<ColumnState[]>([])
  const requests = useRef(new Map<string, AbortController>())
  const viewport = useRef<HTMLDivElement>(null)

  const snapshot = client.getSnapshot()
  const groups = normalGroups(snapshot)
  const root = history[0]?.[0] ?? ''
  const current = columns[columns.length - 1]?.path ?? ''
  const currentListing = columns[columns.length - 1]?.listing
  const currentIndex = columns.length - 1

  useEffect(() => {
    columnsRef.current = columns
    if (open) viewport.current?.scrollTo({ left: viewport.current.scrollWidth })
  }, [columns, open])

  useEffect(() => {
    if (!open) {
      for (const controller of requests.current.values()) controller.abort()
      requests.current.clear()
      return
    }
    const preferred = pickerGroup(client) ?? client.selectedId()
    const group = groups.find(item => item.id === preferred) ?? groups[0]
    setCreating(false)
    setNewName('')
    setSubmitting(false)
    setShowHidden(false)
    setGlobalError('')
    if (group === undefined) {
      setGroupId('')
      columnsRef.current = []
      setColumns([])
      setHistory([])
      setHistoryIndex(-1)
      setGlobalError(copy.noGroup)
      return
    }
    const start = startPath(group, snapshot)
    setGroupId(group.id)
    const column: ColumnState = { path: start, loading: true }
    columnsRef.current = [column]
    setColumns([column])
    setHistory([[start]])
    setHistoryIndex(0)
    void loadColumn(start)
    return () => {
      for (const controller of requests.current.values()) controller.abort()
      requests.current.clear()
    }
  }, [open, client])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !submitting) props.onCancel()
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (!busy && !submitting) setCreating(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, submitting, props.onCancel])

  async function loadColumn(path: string, force = false) {
    const existing = columnsRef.current.find(column => column.path === path)
    if (existing === undefined) return
    if (!force && existing.listing !== undefined) return
    requests.current.get(path)?.abort()
    const controller = new AbortController()
    requests.current.set(path, controller)
    setColumns(prev => prev.map(column => column.path === path ? { ...column, loading: true, error: undefined } : column))
    try {
      const listing = await client.ctx.uiWorkspace.listDirectory(path, controller.signal)
      if (controller.signal.aborted) return
      setColumns(prev => prev.map(column => column.path === path ? { ...column, listing, loading: false } : column))
    } catch (cause) {
      if (!controller.signal.aborted) {
        setColumns(prev => prev.map(column => column.path === path ? { ...column, loading: false, error: messageOf(cause) } : column))
      }
    } finally {
      if (requests.current.get(path) === controller) requests.current.delete(path)
    }
  }

  function setChain(paths: string[]) {
    for (const [path, controller] of requests.current) {
      if (!paths.includes(path)) {
        controller.abort()
        requests.current.delete(path)
      }
    }
    const next = paths.map(path => columnsRef.current.find(column => column.path === path) ?? { path, loading: false })
    columnsRef.current = next
    setColumns(next)
    for (const path of paths) {
      if (next.find(column => column.path === path)?.listing === undefined) void loadColumn(path)
    }
  }

  function record(paths: string[]) {
    setHistory(prev => [...prev.slice(0, historyIndex + 1), paths])
    setHistoryIndex(historyIndex + 1)
  }

  function openAt(index: number) {
    const next = columnsRef.current.slice(0, index + 1).map(column => column.path)
    setChain(next)
    record(next)
  }

  function enter(index: number, path: string) {
    const next = [...columnsRef.current.slice(0, index + 1).map(column => column.path), path]
    setChain(next)
    record(next)
  }

  function back() {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    setChain(history[nextIndex])
  }

  function forward() {
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    setChain(history[nextIndex])
  }

  function selectGroup(group: NormalGroup) {
    const start = startPath(group, snapshot)
    setGroupId(group.id)
    setCreating(false)
    setNewName('')
    setGlobalError('')
    const column: ColumnState = { path: start, loading: true }
    columnsRef.current = [column]
    setColumns([column])
    setHistory([[start]])
    setHistoryIndex(0)
    void loadColumn(start)
  }

  async function createFolder() {
    const name = newName.trim()
    if (name === '' || current === '') return
    setCreating(false)
    setGlobalError('')
    setSubmitting(true)
    try {
      await client.ctx.uiWorkspace.createDirectory(current, name)
      setNewName('')
      await loadColumn(current, true)
    } catch (cause) {
      setGlobalError(messageOf(cause))
      setCreating(true)
    } finally {
      setSubmitting(false)
    }
  }

  function pick() {
    if (current === '' || busy || submitting || columns[currentIndex]?.loading === true) return
    setSubmitting(true)
    props.onPicked(current)
  }

  if (!open) return null

  const crumbs = (currentListing?.crumbs ?? []).filter(crumb =>
    crumb.path === root || crumb.path.startsWith(`${root}/`))
  const breadcrumbs = crumbs.length > 0 ? crumbs : root === '' ? [] : [{ name: baseName(root), path: root }]

  return createPortal(
    <>
      <style>{PICKER_STYLE}</style>
      <div className="smp-wg-picker-mask" onMouseDown={() => { if (!busy && !submitting) props.onCancel() }}>
        <div className="smp-wg-picker" role="dialog" aria-modal="true" aria-label={copy.title} onMouseDown={event => event.stopPropagation()}>
          <header className="smp-wg-picker-head">
            <h2 className="smp-wg-picker-title">{copy.title}</h2>
            <button type="button" className="smp-wg-picker-close" aria-label={copy.cancel} onClick={() => { if (!busy && !submitting) props.onCancel() }}>×</button>
          </header>
          <div className="smp-wg-picker-body">
            <aside className="smp-wg-picker-rail" aria-label={copy.groups}>
              <div className="smp-wg-picker-rail-head">{copy.groups}</div>
              <div className="smp-wg-picker-rail-list">
                {groups.map(group => (
                  <button
                    key={group.id}
                    type="button"
                    className={`smp-wg-picker-group${group.id === groupId ? ' is-current' : ''}`}
                    title={startPath(group, snapshot)}
                    onClick={() => selectGroup(group)}
                  >
                    <FolderIcon />
                    <span className="smp-wg-picker-group-name">{group.label}</span>
                  </button>
                ))}
              </div>
            </aside>
            <div className="smp-wg-picker-main">
              <div className="smp-wg-picker-toolbar">
                <button type="button" className="smp-wg-picker-nav" aria-label={copy.back} onClick={back} disabled={historyIndex <= 0}>←</button>
                <button type="button" className="smp-wg-picker-nav" aria-label={copy.forward} onClick={forward} disabled={historyIndex >= history.length - 1}>→</button>
                <nav className="smp-wg-picker-crumbs" aria-label="path">
                  {breadcrumbs.map((crumb, index) => (
                    <span key={crumb.path} style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {index > 0 && <span className="smp-wg-picker-crumb-sep">/</span>}
                      <button
                        type="button"
                        className={`smp-wg-picker-crumb${crumb.path === current ? ' is-current' : ''}`}
                        onClick={() => {
                          const target = columnsRef.current.findIndex(column => column.path === crumb.path)
                          if (target >= 0) openAt(target)
                        }}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </nav>
                <label className="smp-wg-picker-hidden">
                  <input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)} />
                  {copy.hidden}
                </label>
              </div>
              {globalError !== '' && <div className="smp-wg-picker-global-error">{globalError}</div>}
              <div className="smp-wg-picker-columns" ref={viewport}>
                {columns.map((column, index) => {
                  const entries = (column.listing?.entries ?? []).filter(entry => showHidden || !entry.hidden)
                  const nextPath = columns[index + 1]?.path
                  return (
                    <section className="smp-wg-picker-column" key={column.path} aria-label={baseName(column.path)}>
                      <div className="smp-wg-picker-column-inner">
                        {column.loading && column.listing === undefined ? <div className="smp-wg-picker-column-loading">{copy.loading}</div> : null}
                        {column.error !== undefined ? <div className="smp-wg-picker-column-error">{column.error}</div> : null}
                        {!column.loading && column.error === undefined && entries.length === 0 ? <div className="smp-wg-picker-column-empty">{copy.empty}</div> : null}
                        {entries.map(entry => {
                          const selected = entry.path === nextPath || (index === currentIndex && entry.path === current)
                          return (
                            <button
                              key={entry.path}
                              type="button"
                              className={`smp-wg-picker-row${selected ? ' is-current' : ''}${entry.hidden ? ' is-hidden' : ''}`}
                              title={entry.path}
                              onClick={() => enter(index, entry.path)}
                            >
                              <FolderIcon />
                              <span className="smp-wg-picker-row-name">{entry.name}</span>
                              <span className="smp-wg-picker-row-enter">›</span>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          </div>
          <footer className="smp-wg-picker-foot">
            <div className="smp-wg-picker-foot-group">
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
                <button type="button" className="smp-wg-picker-btn" onClick={() => setCreating(true)} disabled={busy || submitting || current === ''}>{copy.create}</button>
              )}
            </div>
            <div className="smp-wg-picker-foot-group is-right">
              <button type="button" className="smp-wg-picker-btn" onClick={() => { if (!busy && !submitting) props.onCancel() }} disabled={busy || submitting}>{copy.cancel}</button>
              <button type="button" className="smp-wg-picker-btn is-primary" onClick={pick} disabled={busy || submitting || current === '' || columns[currentIndex]?.loading === true}>{copy.pick}</button>
            </div>
          </footer>
        </div>
      </div>
    </>,
    document.body,
  )
}
