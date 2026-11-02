export type SessionSearchBy = 'title' | 'id'

export type SessionStatusFilter = 'all' | 'active' | 'archived'

export interface SessionSearchRow {
  id: string
  title: string
  archived: boolean
  updatedAt: number
}

export interface SessionFilter {
  by: SessionSearchBy
  query: string
  status: SessionStatusFilter
  from: string
  to: string
}

/** Empty text keeps every row. Title and id are separate, case-insensitive substrings. */
export function sessionMatches(row: Pick<SessionSearchRow, 'id' | 'title'>, by: SessionSearchBy, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const haystack = by === 'id' ? row.id : row.title
  return haystack.toLowerCase().includes(needle)
}

export function sessionIdError(id: string): string | undefined {
  if (id === '' || /\s/.test(id) || id.length > 200) return '会话编号不对'
  return undefined
}

/** Inclusive local dates. A blank bound does not constrain that side. */
export function sessionOnDates(updatedAt: number, from: string, to: string): boolean {
  const start = dayStart(from)
  const end = dayEnd(to)
  if (start === undefined && end === undefined) return true
  if (updatedAt <= 0) return false
  if (start !== undefined && updatedAt < start) return false
  if (end !== undefined && updatedAt > end) return false
  return true
}

export function sessionStatusMatches(archived: boolean, status: SessionStatusFilter): boolean {
  if (status === 'all') return true
  return status === 'archived' ? archived : !archived
}

export function sessionVisible(row: SessionSearchRow, filter: SessionFilter): boolean {
  return sessionMatches(row, filter.by, filter.query)
    && sessionStatusMatches(row.archived, filter.status)
    && sessionOnDates(row.updatedAt, filter.from, filter.to)
}

export interface WorkspaceAccount {
  title: string
  path: string
  sessionIds: readonly string[]
  workspaceId?: string
}

const DEFAULT_WORKSPACE_TITLE = 'default-workspace'

/** The workspace that owns the session, or the one whose directory matches. */
export function workspaceOf(sessionId: string, cwd: string | undefined, accounts: readonly WorkspaceAccount[]): WorkspaceAccount | undefined {
  const owned = accounts.find(account => account.sessionIds.includes(sessionId))
  if (owned !== undefined) return owned
  if (cwd === undefined || cwd === '') return undefined
  return accounts.find(account => account.path === cwd)
}

export function workspaceName(title: string, fallback: string): string {
  return title === DEFAULT_WORKSPACE_TITLE ? fallback : title
}

/** The caller resolves group labels through workspaceGroups using the active language. */
export function archiveWorkspaceLabel(groupLabel: string, title: string, workspaceFallback: string): string {
  return `${groupLabel}/${workspaceName(title, workspaceFallback)}`
}

export function sessionWorkspaceMatches(path: string, selected: string): boolean {
  return selected === '' || path === selected
}

export const PAGE_SIZES = [10, 20, 50] as const

export function isPageSize(value: number): boolean {
  return (PAGE_SIZES as readonly number[]).includes(value)
}

export function pageCount(total: number, size: number): number {
  if (size < 1) return 1
  return Math.max(1, Math.ceil(total / size))
}

export function clampPage(page: number, total: number, size: number): number {
  const pages = pageCount(total, size)
  if (!Number.isFinite(page) || page < 1) return 1
  if (page > pages) return pages
  return Math.floor(page)
}

export function pageSlice<T>(rows: readonly T[], page: number, size: number): readonly T[] {
  if (size < 1) return []
  const current = clampPage(page, rows.length, size)
  const start = (current - 1) * size
  return rows.slice(start, start + size)
}

/** A positive page number, clamped to the list. Anything else stays put. */
export function jumpTarget(raw: string, total: number, size: number): number | undefined {
  if (!/^[1-9]\d*$/.test(raw.trim())) return undefined
  return clampPage(Number(raw), total, size)
}

function dayStart(day: string): number | undefined {
  return dayBound(day, false)
}

function dayEnd(day: string): number | undefined {
  return dayBound(day, true)
}

function dayBound(day: string, end: boolean): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  const value = end
    ? new Date(year, month - 1, date, 23, 59, 59, 999).getTime()
    : new Date(year, month - 1, date, 0, 0, 0, 0).getTime()
  if (Number.isNaN(value)) return undefined
  const check = new Date(value)
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== date) return undefined
  return value
}

