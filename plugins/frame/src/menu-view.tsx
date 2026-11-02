import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { Panel } from '@smp/console-kit'
import { shellCopy } from './copy.ts'
import type { MenuStore } from './menu-store.ts'
import { SECTION_LIMIT, createGroup, deleteGroup, menuChoices, menuList, moveGroup, moveItem, renameGroup, resolveLayout, untitledName, type MenuLayout, type MenuOption } from './menu.ts'
import { navGroups, pageRoutes, visibleGroups, type RegisteredPage } from './pages.ts'
import type { LocaleFace } from './general-view.tsx'

interface PageSlots {
  entries(name: string): readonly RegisteredPage[]
  subscribe(name: string, listener: () => void): () => void
}

export function MenuView(props: { slots: PageSlots; locale: LocaleFace; menu: MenuStore }) {
  const entries = useSyncExternalStore(listener => props.slots.subscribe('console.page', listener), () => props.slots.entries('console.page'))
  const locale = useSyncExternalStore(listener => props.locale.subscribe(listener), () => props.locale.getSnapshot())
  const saved = useSyncExternalStore(props.menu.subscribe, props.menu.get)
  const copy = shellCopy(locale.active)
  const routes = navGroups(pageRoutes(entries))
  const options = menuChoices(visibleGroups(routes), copy.harness)
  const layout = resolveLayout(saved, copy.overview)
  const list = menuList(options, layout, copy.overview)
  const [over, setOver] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState('')

  async function persist(next: MenuLayout): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/console-api/menu', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      const payload = await response.json() as { detail?: unknown }
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.requestFailed)
      props.menu.apply(next)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.requestFailed)
      return false
    } finally {
      setBusy(false)
    }
  }

  function onCreate(): void {
    const title = untitledName(layout.groups.map(group => group.title), copy.menuUntitled)
    const id = groupId()
    const next = createGroup(layout, title, id)
    if (!('groups' in next)) {
      setError(copy.menuDuplicate)
      return
    }
    void persist(next).then(saved => { if (saved) setEditing(id) })
  }

  function onRename(id: string, title: string): void {
    const next = renameGroup(layout, id, title)
    if (!('groups' in next)) {
      setError(copy.menuDuplicate)
      return
    }
    setEditing('')
    void persist(next)
  }

  function onDelete(id: string): void {
    void persist(deleteGroup(layout, id))
  }

  function onDrop(event: DragEvent<HTMLElement>, groupId: string): void {
    event.preventDefault()
    setOver('')
    if (draggingKind === 'group') {
      const id = dragging
      clearDrag()
      if (groupId === '' || id === '') return
      const board = event.currentTarget.closest('.menu-board')
      const rows = board === null ? [] : [...board.querySelectorAll<HTMLElement>('[data-group]')]
      let index = rows.length
      for (let i = 0; i < rows.length; i += 1) {
        const box = rows[i]?.getBoundingClientRect()
        if (box !== undefined && event.clientY < box.top + box.height / 2) {
          index = i
          break
        }
      }
      void persist(moveGroup(layout, id, index))
      return
    }
    const optionId = event.dataTransfer.getData('text/plain') || dragging
    clearDrag()
    if (optionId === '') return
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-option]')]
    let index = rows.length
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i]?.getBoundingClientRect()
      if (box !== undefined && event.clientY < box.top + box.height / 2) {
        index = i
        break
      }
    }
    void persist(moveItem(layout, options, optionId, groupId, index))
  }

  return (
    <Panel
      title={copy.menu}
      extra={<button className="primary" type="button" disabled={busy} onClick={onCreate}>{copy.menuCreate}</button>}
    >
      <p className="muted">{copy.menuHint}</p>
      {error !== '' && <p className="banner">{error}</p>}
      <div className="menu-board">
        <DropList title={copy.menuUngrouped} groupId="" items={list.ungrouped} over={over} setOver={setOver} onDrop={onDrop} empty={copy.menuEmpty} />
        {list.groups.map(group => (
          <DropList
            key={group.id}
            title={group.title}
            groupId={group.id}
            items={group.items}
            over={over}
            setOver={setOver}
            onDrop={onDrop}
            empty={copy.menuEmpty}
            editing={editing === group.id}
            editLabel={copy.menuEdit}
            nameLabel={copy.menuName}
            onEdit={() => setEditing(group.id)}
            onRename={title => onRename(group.id, title)}
            onCancel={() => setEditing('')}
            saveLabel={copy.save}
            cancelLabel={copy.cancel}
            dragLabel={copy.menuDrag}
            onDelete={() => onDelete(group.id)}
            deleteLabel={copy.menuDelete}
          />
        ))}
      </div>
    </Panel>
  )
}

function DropList(props: {
  title: string
  groupId: string
  items: readonly MenuOption[]
  over: string
  setOver: (id: string) => void
  onDrop: (event: DragEvent<HTMLElement>, groupId: string) => void
  empty: string
  editing?: boolean
  editLabel?: string
  nameLabel?: string
  onEdit?: () => void
  onRename?: (title: string) => void
  onCancel?: () => void
  saveLabel?: string
  cancelLabel?: string
  dragLabel?: string
  onDelete?: () => void
  deleteLabel?: string
}) {
  const named = props.groupId !== ''
  return (
    <section
      aria-label={props.editing ? undefined : props.title}
      data-group={named ? props.groupId : undefined}
      className={`menu-group${props.over === props.groupId ? ' is-over' : ''}`}
      onDragOver={event => {
        if (draggingKind === 'group' && !named) return
        event.preventDefault()
        props.setOver(props.groupId)
      }}
      onDragLeave={() => { if (props.over === props.groupId) props.setOver('') }}
      onDrop={event => props.onDrop(event, props.groupId)}
    >
      <header>
        <span className="menu-heading">
          {named && (
            <span
              className="menu-grip"
              role="button"
              aria-label={props.dragLabel}
              draggable
              onDragStart={event => {
                dragging = props.groupId
                draggingKind = 'group'
                event.dataTransfer.setData('text/plain', props.groupId)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={clearDrag}
            />
          )}
          {props.editing && props.onRename !== undefined && props.onCancel !== undefined ? (
            <GroupName
              title={props.title}
              label={props.nameLabel ?? props.title}
              saveLabel={props.saveLabel ?? ''}
              cancelLabel={props.cancelLabel ?? ''}
              onCommit={props.onRename}
              onCancel={props.onCancel}
            />
          ) : <span>{props.title}</span>}
        </span>
        {props.onDelete !== undefined && (
          <span className="actions">
            {props.onEdit !== undefined && !props.editing && (
              <button className="link" type="button" onClick={props.onEdit}>{props.editLabel}</button>
            )}
            <button className="link" type="button" onMouseDown={event => event.preventDefault()} onClick={props.onDelete}>{props.deleteLabel}</button>
          </span>
        )}
      </header>
      {props.items.map(item => (
        <div
          key={item.id}
          role="button"
          aria-label={item.label}
          className="menu-item"
          data-option={item.id}
          draggable
          onDragStart={event => {
            dragging = item.id
            draggingKind = 'item'
            event.dataTransfer.setData('text/plain', item.id)
            event.dataTransfer.effectAllowed = 'move'
            event.stopPropagation()
          }}
          onDragEnd={clearDrag}
        >
          <span className="menu-grip" aria-hidden="true" />
          <span>{item.label}</span>
        </div>
      ))}
      {props.items.length === 0 && <p className="menu-empty">{props.empty}</p>}
    </section>
  )
}

function GroupName(props: {
  title: string
  label: string
  saveLabel: string
  cancelLabel: string
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(props.title)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  function commit(): void {
    const text = value.trim()
    if (text === props.title) props.onCancel()
    else props.onCommit(text)
  }
  return (
    <span className="menu-rename">
      <input
        ref={field}
        aria-label={props.label}
        value={value}
        maxLength={SECTION_LIMIT}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            props.onCancel()
          }
        }}
      />
      <button className="menu-mark ok" type="button" aria-label={props.saveLabel} onMouseDown={event => event.preventDefault()} onClick={commit}>
        <CheckIcon />
      </button>
      <button className="menu-mark no" type="button" aria-label={props.cancelLabel} onMouseDown={event => event.preventDefault()} onClick={props.onCancel}>
        <CrossIcon />
      </button>
    </span>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3.2 8.4 6.3 11.5 12.8 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

let dragging = ''
let draggingKind: 'item' | 'group' = 'item'

function clearDrag(): void {
  dragging = ''
  draggingKind = 'item'
}

function groupId(): string {
  return `g${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}
