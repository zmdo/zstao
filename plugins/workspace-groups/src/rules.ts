/** One workspace belongs to one group. Group names live with the plugin that registered them. */
import type { GroupLabel, GroupLabelI18n } from './contract.ts'
import { groupCopy, localizedGroupLabel } from './copy.ts'

export const GENERAL_GROUP_ID = 'general'
export const GENERAL_GROUP_LABEL = groupCopy('zh').general
export const UNASSIGNED_GROUP_ID = 'unassigned'
export const UNASSIGNED_GROUP_LABEL = groupCopy('zh').unassigned
export const DEFAULT_WORKSPACE_TITLE = 'default-workspace'

export interface GroupSpec extends GroupLabel {
  id: string
  directory: string
  order: number
}

export interface GroupInput extends GroupLabel {
  id: string
  directory: string
  order?: number
}

export interface MemberRow {
  workspaceId: string
  groupId: string
  isDefault: boolean
}

export interface AllowSpec {
  id: string
  groups: string[]
  pages: string[]
}

export interface SessionFace {
  byId: Record<string, { id: string; cwd?: string; retainedBy?: { mainView?: number } }>
}

export interface WorkspaceFace {
  workspaceId?: string
  path: string
  title: string
  sessionIds: readonly string[]
}

export function normalizeGroup(input: GroupInput): GroupSpec {
  const id = input.id.trim()
  const label = input.label.trim()
  const directory = input.directory.trim()
  if (id === '' || label === '' || directory === '') throw new Error('工作区组的编号、名称和目录都不能为空')
  if (id === UNASSIGNED_GROUP_ID) throw new Error('未归属是系统保留的工作区组')
  let labelI18n: GroupLabelI18n | undefined
  if (input.labelI18n !== undefined) {
    if (input.labelI18n === null || typeof input.labelI18n !== 'object' || Array.isArray(input.labelI18n)
      || Object.keys(input.labelI18n).some(language => language !== 'zh' && language !== 'en')) throw new Error('工作区组的翻译必须使用 zh、en 语言键')
    const labels: Partial<Record<'zh' | 'en', string>> = {}
    for (const language of ['zh', 'en'] as const) {
      const value = input.labelI18n[language]
      if (value === undefined) continue
      if (typeof value !== 'string' || value.trim() === '') throw new Error(`工作区组的 ${language} 名称不能为空`)
      labels[language] = value.trim()
    }
    labelI18n = labels
  }
  return { id, label, directory, order: input.order ?? 0, ...(labelI18n === undefined ? {} : { labelI18n }) }
}

export function rememberGroup(groups: readonly GroupSpec[], spec: GroupSpec): GroupSpec[] {
  if (groups.some(group => group.id === spec.id)) throw new Error(`已经注册过工作区组 ${spec.id}`)
  return [...groups, spec]
}

export function normalizeAllow(input: { id: string; groups: readonly string[]; pages?: readonly string[] }): AllowSpec {
  const id = input.id.trim()
  const groups = input.groups.map(group => group.trim()).filter(group => group !== '')
  if (id === '') throw new Error('可用范围缺少插件编号')
  if (groups.length === 0) throw new Error('至少要指定一个工作区组')
  const pages = [...new Set((input.pages ?? []).map(page => page.trim()).filter(page => page !== ''))]
  return { id, groups, pages }
}

export function rememberAllow(allows: readonly AllowSpec[], spec: AllowSpec): AllowSpec[] {
  if (allows.some(rule => rule.id === spec.id)) throw new Error(`已经登记过 ${spec.id}`)
  return [...allows, spec]
}

/** Workspaces that have no membership row stay unassigned until explicitly claimed. */
export function ungroupedIds(workspaceIds: readonly string[], members: readonly MemberRow[]): string[] {
  const known = new Set(members.map(row => row.workspaceId))
  return workspaceIds.filter(id => !known.has(id))
}

export type ClaimResult =
  | { ok: true; insert: boolean }
  | { ok: false; detail: string }

/** A newly added workspace joins the current group. A workspace already in another group stays there. */
export function claimWorkspace(members: readonly MemberRow[], workspaceId: string, groupId: string, groupLabel: string): ClaimResult {
  const existing = members.find(row => row.workspaceId === workspaceId)
  if (existing === undefined) return { ok: true, insert: true }
  if (existing.groupId === groupId) return { ok: true, insert: false }
  return { ok: false, detail: `这个目录已经属于「${groupLabel}」` }
}

export type DefaultPlan =
  | { action: 'keep' }
  | { action: 'mark'; workspaceId: string }
  | { action: 'create' }

/** The bound directory's default-workspace is created, or adopted when that path is already registered. */
export function planDefault(members: readonly MemberRow[], groupId: string, workspaceAtPath: string | undefined): DefaultPlan {
  if (members.some(row => row.groupId === groupId && row.isDefault)) return { action: 'keep' }
  if (workspaceAtPath !== undefined) return { action: 'mark', workspaceId: workspaceAtPath }
  return { action: 'create' }
}

/** The focused workspace wins while it still belongs to the group. Otherwise the group's default. */
export function focusedWorkspace(members: readonly MemberRow[], groupId: string, focusWorkspaceId: string | undefined): string | undefined {
  const inGroup = members.filter(row => row.groupId === groupId)
  if (focusWorkspaceId !== undefined && inGroup.some(row => row.workspaceId === focusWorkspaceId)) return focusWorkspaceId
  return inGroup.find(row => row.isDefault)?.workspaceId
}

export function displayDirectory(directory: string): string {
  const relative = directory.replace(/^[/\\]+/, '')
  return `~/${relative}`
}

/** No open session: the sidebar's group. An open session: that session's workspace group. */
export function judgingGroup(sessionGroupId: string | undefined, selectedGroupId: string): string {
  return sessionGroupId ?? selectedGroupId
}

/** Workspace accounts are authoritative; cwd alone never assigns an orphan to a group. */
export function sessionWorkspaceGroup(sessions: SessionFace, workspaces: readonly WorkspaceFace[], members: readonly MemberRow[]): string | undefined {
  const main = Object.values(sessions.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)
  if (main === undefined) return undefined
  return groupForSession(main.id, workspaces, members)
}

export function groupForSession(sessionId: string, workspaces: readonly WorkspaceFace[], members: readonly MemberRow[]): string | undefined {
  const item = workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
  if (item === undefined) return UNASSIGNED_GROUP_ID
  const member = members.find(row => row.workspaceId === item.workspaceId)
  return member?.groupId
}

export function pluginUsable(allows: readonly AllowSpec[], pluginId: string, groupId: string, registered: ReadonlySet<string>): boolean {
  const rule = allows.find(item => item.id === pluginId)
  if (rule === undefined) return true
  return registered.has(groupId) && rule.groups.includes(groupId)
}

export function pagesHidden(allows: readonly AllowSpec[], groupId: string, registered: ReadonlySet<string>): string[] {
  const hidden: string[] = []
  for (const rule of allows) {
    if (registered.has(groupId) && rule.groups.includes(groupId)) continue
    hidden.push(...rule.pages)
  }
  return hidden
}

export function toolRefusal(groupLabel: string): string {
  return `当前工作区组「${groupLabel}」不能使用这个功能`
}

export function groupLabelOf(workspaceId: string | undefined, members: readonly MemberRow[], groups: readonly (GroupLabel & { id: string })[], active = 'zh'): string {
  const groupId = members.find(row => row.workspaceId === workspaceId)?.groupId ?? GENERAL_GROUP_ID
  const group = groups.find(group => group.id === groupId)
  return group === undefined ? groupCopy(active).general : localizedGroupLabel(group, active)
}
