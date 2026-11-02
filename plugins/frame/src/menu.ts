import type { NavGroup } from './pages.ts'

/** Built-in conversation row. It is not a registered page. */
export const CONVERSATION_ID = 'conversation'
export const SECTION_LIMIT = 40

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface MenuOption {
  id: string
  label: string
  placement: 'nav'
  order: number
  icon: string
}

export interface MenuGroup {
  id: string
  title: string
  sort: number
}

export interface MenuAssignment {
  id: string
  groupId: string
  sort: number
}

export interface MenuLayout {
  groups: MenuGroup[]
  items: MenuAssignment[]
}

export interface PlacedOption extends MenuOption {
  section: string
}

export interface MenuBlock {
  id: string
  title: string
  items: PlacedOption[]
}

export interface MenuListGroup {
  id: string
  title: string
  items: MenuOption[]
}

export interface MenuList {
  ungrouped: MenuOption[]
  groups: MenuListGroup[]
}

export type MenuDraft =
  | { ok: true; layout: MenuLayout }
  | { ok: false }

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/** Sidebar rows the menu tab can arrange. Footer groups, including platform settings, stay out. */
export function menuChoices(groups: { nav: readonly NavGroup[]; footer?: readonly NavGroup[] }, conversation: string): MenuOption[] {
  return [
    { id: CONVERSATION_ID, label: conversation, placement: 'nav', order: -1, icon: 'chat' },
    ...groups.nav.map(group => ({
      id: group.id,
      label: group.label,
      placement: 'nav' as const,
      order: group.order,
      icon: group.icon,
    })),
  ]
}

/** Nothing stored yet keeps Harness under the overview heading. */
export function resolveLayout(saved: MenuLayout, overview: string): MenuLayout {
  if (saved.groups.length === 0 && saved.items.length === 0) {
    return {
      groups: [{ id: 'overview', title: overview, sort: 0 }],
      items: [{ id: CONVERSATION_ID, groupId: 'overview', sort: 0 }],
    }
  }
  return saved
}

/** Groups in saved order. Empty groups stay in the editor and do not take a sidebar heading. */
export function sidebarBlocks(options: readonly MenuOption[], saved: MenuLayout, overview: string): MenuBlock[] {
  const list = menuList(options, saved, overview)
  const blocks: MenuBlock[] = list.groups
    .filter(group => group.items.length > 0)
    .map(group => ({
      id: group.id,
      title: group.title,
      items: group.items.map(item => ({ ...item, section: group.title })),
    }))
  for (const item of list.ungrouped) {
    blocks.push({ id: `ungrouped:${item.id}`, title: '', items: [{ ...item, section: '' }] })
  }
  return blocks
}

export function menuList(options: readonly MenuOption[], saved: MenuLayout, overview: string): MenuList {
  const layout = resolveLayout(saved, overview)
  const byOption = new Map(options.map(option => [option.id, option]))
  const groups = [...layout.groups].sort((left, right) => left.sort - right.sort || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const assigned = new Set<string>()
  const listed = groups.map(group => {
    const items = layout.items
      .filter(item => item.groupId === group.id && byOption.has(item.id))
      .sort(bySort)
      .map(item => {
        assigned.add(item.id)
        return byOption.get(item.id) as MenuOption
      })
    return { id: group.id, title: group.title, items }
  })
  const ungrouped = layout.items
    .filter(item => item.groupId === '' && byOption.has(item.id))
    .sort(bySort)
    .map(item => {
      assigned.add(item.id)
      return byOption.get(item.id) as MenuOption
    })
  const rest = options
    .filter(option => !assigned.has(option.id))
    .sort((left, right) => left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return { ungrouped: [...ungrouped, ...rest], groups: listed }
}

/** Smallest unused "前缀 N", starting at 1. */
export function untitledName(titles: readonly string[], prefix: string): string {
  const used = new Set(titles)
  let number = 1
  while (used.has(`${prefix}${number}`)) number += 1
  return `${prefix}${number}`
}

export function renameGroup(layout: MenuLayout, id: string, title: string): MenuLayout | { ok: false } {
  const text = title.trim()
  if (text === '' || text.length > SECTION_LIMIT) return { ok: false }
  if (!layout.groups.some(group => group.id === id)) return { ok: false }
  if (layout.groups.some(group => group.id !== id && group.title === text)) return { ok: false }
  return { groups: layout.groups.map(group => group.id === id ? { ...group, title: text } : group), items: layout.items }
}

export function createGroup(layout: MenuLayout, title: string, id: string): MenuLayout | { ok: false } {
  const text = title.trim()
  if (text === '' || text.length > SECTION_LIMIT || !ID_PATTERN.test(id)) return { ok: false }
  if (layout.groups.some(group => group.title === text || group.id === id)) return { ok: false }
  const sort = layout.groups.reduce((max, group) => Math.max(max, group.sort), -1) + 1
  return { groups: [...layout.groups, { id, title: text, sort }], items: layout.items }
}

/** `index` is the position among groups before the moved group is removed. */
export function moveGroup(layout: MenuLayout, id: string, index: number): MenuLayout {
  const groups = [...layout.groups].sort((left, right) => left.sort - right.sort || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const from = groups.findIndex(group => group.id === id)
  if (from < 0) return layout
  let at = index
  if (from < at) at -= 1
  at = Math.max(0, Math.min(at, groups.length - 1))
  const [moved] = groups.splice(from, 1)
  if (moved === undefined) return layout
  groups.splice(at, 0, moved)
  return { groups: groups.map((group, position) => ({ ...group, sort: position })), items: layout.items }
}

export function deleteGroup(layout: MenuLayout, groupId: string): MenuLayout {
  const removed = layout.items.filter(item => item.groupId === groupId).sort(bySort)
  const kept = layout.items.filter(item => item.groupId !== groupId)
  const ungrouped = kept.filter(item => item.groupId === '').sort(bySort)
  const others = kept.filter(item => item.groupId !== '')
  const merged = [...ungrouped, ...removed].map((item, index) => ({ ...item, groupId: '', sort: index }))
  return {
    groups: layout.groups.filter(group => group.id !== groupId),
    items: [...others, ...merged],
  }
}

/** `index` is the position in the destination list before the item is removed. */
export function moveItem(layout: MenuLayout, options: readonly MenuOption[], optionId: string, groupId: string, index: number): MenuLayout {
  if (!options.some(option => option.id === optionId)) return layout
  if (groupId !== '' && !layout.groups.some(group => group.id === groupId)) return layout
  const rows = materialize(layout, options)
  const from = rows.find(item => item.id === optionId)
  if (from === undefined) return layout
  const same = from.groupId === groupId
  const source = rows.filter(item => item.groupId === from.groupId).sort(bySort)
  const old = source.findIndex(item => item.id === optionId)
  let at = index
  if (same && old >= 0 && old < at) at -= 1
  const destination = (same ? source : rows.filter(item => item.groupId === groupId).sort(bySort))
    .filter(item => item.id !== optionId)
  at = Math.max(0, Math.min(at, destination.length))
  destination.splice(at, 0, { id: optionId, groupId, sort: at })
  const next = rows.filter(item => item.groupId !== from.groupId && item.groupId !== groupId)
  return { groups: layout.groups, items: [...next, ...renumber(from.groupId === groupId ? [] : source.filter(item => item.id !== optionId), from.groupId), ...renumber(destination, groupId)] }
}

/** Replace the stored groups and item order. Unknown shapes are refused. */
export function menuDraft(body: unknown): MenuDraft {
  if (body === null || typeof body !== 'object') return { ok: false }
  const groups = readGroups((body as { groups?: unknown }).groups)
  const items = readItems((body as { items?: unknown }).items)
  if (groups === undefined || items === undefined) return { ok: false }
  const ids = new Set(groups.map(group => group.id))
  if (items.some(item => item.groupId !== '' && !ids.has(item.groupId))) return { ok: false }
  return { ok: true, layout: { groups, items } }
}

export async function loadMenu(db: Queryable): Promise<MenuLayout> {
  const groups = await db.query('select id, title, sort from console_menu_group order by sort, id')
  const items = await db.query('select option_id as id, group_id as "groupId", sort from console_menu order by sort, option_id')
  return {
    groups: groups.rows.map(row => ({ id: text(row.id), title: text(row.title), sort: number(row.sort) })),
    items: items.rows.map(row => ({ id: text(row.id), groupId: text(row.groupId), sort: number(row.sort) })),
  }
}

export async function saveMenu(db: Queryable, layout: MenuLayout): Promise<void> {
  await db.query('delete from console_menu')
  await db.query('delete from console_menu_group')
  if (layout.groups.length > 0) {
    await db.query(
      'insert into console_menu_group (id, title, sort) select * from unnest($1::text[], $2::text[], $3::int[])',
      [layout.groups.map(group => group.id), layout.groups.map(group => group.title), layout.groups.map(group => group.sort)],
    )
  }
  if (layout.items.length > 0) {
    await db.query(
      'insert into console_menu (option_id, group_id, section, sort) select id, group_id, \'\', sort from unnest($1::text[], $2::text[], $3::int[]) as row(id, group_id, sort)',
      [layout.items.map(item => item.id), layout.items.map(item => item.groupId), layout.items.map(item => item.sort)],
    )
  }
}

function materialize(layout: MenuLayout, options: readonly MenuOption[]): MenuAssignment[] {
  const known = new Set(options.map(option => option.id))
  const rows = layout.items.filter(item => known.has(item.id))
  const seen = new Set(rows.map(item => item.id))
  const extra = options
    .filter(option => !seen.has(option.id))
    .map((option, index) => ({ id: option.id, groupId: '', sort: 1000 + index }))
  return [...rows, ...extra]
}

function renumber(items: readonly MenuAssignment[], groupId: string): MenuAssignment[] {
  return items.map((item, index) => ({ id: item.id, groupId, sort: index }))
}

function bySort(left: { sort: number; id: string }, right: { sort: number; id: string }): number {
  return left.sort - right.sort || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

function readGroups(value: unknown): MenuGroup[] | undefined {
  if (!Array.isArray(value) || value.length > 40) return undefined
  const groups: MenuGroup[] = []
  const seen = new Set<string>()
  for (const row of value) {
    if (row === null || typeof row !== 'object') return undefined
    const id = (row as { id?: unknown }).id
    const title = (row as { title?: unknown }).title
    const sort = (row as { sort?: unknown }).sort
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) return undefined
    if (typeof title !== 'string' || title.trim() === '' || title.trim().length > SECTION_LIMIT) return undefined
    if (typeof sort !== 'number' || !Number.isInteger(sort)) return undefined
    seen.add(id)
    groups.push({ id, title: title.trim(), sort })
  }
  return groups
}

function readItems(value: unknown): MenuAssignment[] | undefined {
  if (!Array.isArray(value) || value.length > 80) return undefined
  const items: MenuAssignment[] = []
  const seen = new Set<string>()
  for (const row of value) {
    if (row === null || typeof row !== 'object') return undefined
    const id = (row as { id?: unknown }).id
    const groupId = (row as { groupId?: unknown }).groupId
    const sort = (row as { sort?: unknown }).sort
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) return undefined
    if (typeof groupId !== 'string' || (groupId !== '' && !ID_PATTERN.test(groupId))) return undefined
    if (typeof sort !== 'number' || !Number.isInteger(sort)) return undefined
    seen.add(id)
    items.push({ id, groupId, sort })
  }
  return items
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
