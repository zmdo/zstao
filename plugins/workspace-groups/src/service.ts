import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { GroupFailure, type GroupSnapshot, type Member, type Focus, type RegisteredGroup } from './contract.ts'
import { GENERAL_GROUP_ID, GENERAL_GROUP_LABEL, UNASSIGNED_GROUP_ID, UNASSIGNED_GROUP_LABEL, DEFAULT_WORKSPACE_TITLE, normalizeGroup, normalizeAllow, rememberAllow, pagesHidden, pluginUsable, type GroupInput } from './rules.ts'
import { groupCopy } from './copy.ts'
import { defaultWorkspacePath, ensureDirectory, resolveGroupDirectory } from './paths.ts'

export interface Queryable {
  query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>
}

export interface WorkspaceRecord {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
  setTitle(title: string): Promise<void>
  attachSession(id: string): Promise<void>
}

export interface Registry {
  list(): readonly WorkspaceRecord[]
  get(id: string): WorkspaceRecord | undefined
  create(path: string, title?: string): Promise<WorkspaceRecord>
  delete(id: string): Promise<boolean>
  readonly archivedSessionIds: readonly string[]
}

interface DirectoryRow extends Record<string, unknown> { directory: string; group_id: string; state: 'pending' | 'ready' }
interface MemberRecord extends Record<string, unknown> { workspace_id: string; group_id: string; directory: string; is_default: boolean; last_session_id: string | null }
interface FocusRecord extends Record<string, unknown> { group_id: string; workspace_id: string | null; session_id: string | null }

/** One apply owns the queue. Registry and SQL writes have a recoverable boundary, not a shared transaction. */
export class GroupRegistry {
  private readonly groups = new Map<string, RegisteredGroup>()
  private allows: GroupSnapshot['allows'] = []
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false

  private readonly db: Queryable
  private readonly registry: Registry
  private readonly home: string
  constructor(db: Queryable, registry: Registry, home: string) {
    this.db = db; this.registry = registry; this.home = home
    this.groups.set(UNASSIGNED_GROUP_ID, { kind: 'system', id: UNASSIGNED_GROUP_ID, label: UNASSIGNED_GROUP_LABEL,
      labelI18n: { zh: groupCopy('zh').unassigned, en: groupCopy('en').unassigned }, order: Number.MAX_SAFE_INTEGER })
  }

  async close(): Promise<void> { this.closing = true; await this.tail }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new GroupFailure('workspace-group/closing', '工作区组服务正在关闭', 503))
    const result = this.tail.then(run)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  register(input: GroupInput): Promise<void> {
    return this.enqueue(async () => {
      const spec = normalizeGroup(input)
      if (this.groups.has(spec.id)) throw new GroupFailure('workspace-group/duplicate', `已经注册过工作区组 ${spec.id}`, 409)
      const path = resolveGroupDirectory(this.home, spec.directory)
      await ensureDirectory(path)
      this.groups.set(spec.id, { ...spec, path: await realpath(path), kind: 'normal' })
      await this.recover()
      await this.ensureDefault(spec.id)
    })
  }

  allow(input: { id: string; groups: readonly string[]; pages?: readonly string[] }): void {
    this.allows = rememberAllow(this.allows, normalizeAllow(input))
  }
  usable(pluginId: string, groupId: string): boolean { return pluginUsable(this.allows, pluginId, groupId, new Set(this.groups.keys())) }
  refusal(pluginId: string, groupId: string): string | undefined { return this.usable(pluginId, groupId) ? undefined : `当前工作区组「${this.groups.get(groupId)?.label ?? groupId}」不能使用这个功能` }
  hiddenPages(groupId: string): string[] { return pagesHidden(this.allows, groupId, new Set(this.groups.keys())) }

  async groupForSession(id: string): Promise<string | undefined> {
    const item = this.registry.list().find(w => w.sessionIds.includes(id))
    if (item === undefined) return UNASSIGNED_GROUP_ID
    return (await this.members()).find(m => m.workspaceId === item.id)?.groupId
  }

  view(): Promise<GroupSnapshot> {
    return this.enqueue(async () => {
      await this.reconcile()
      const [members, focus] = await Promise.all([this.members(), this.focusRows()])
      return { groups: [...this.groups.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), members, focus, allows: [...this.allows] }
    })
  }

  add(groupId: string, path: string, title?: string): Promise<{ workspaceId: string; created: boolean }> {
    return this.enqueue(async () => {
      this.normal(groupId)
      if (!isAbsolute(path)) throw new GroupFailure('workspace-group/invalid-path', '请选择绝对目录路径')
      let canonical: string
      try { canonical = await realpath(path) } catch (cause) { throw new GroupFailure('workspace-group/invalid-path', '目录不存在或无法访问', 400, undefined, { cause }) }
      if (!(await stat(canonical)).isDirectory()) throw new GroupFailure('workspace-group/invalid-path', '所选路径不是目录')
      await this.reconcile()
      return this.addCanonical(groupId, canonical, title)
    })
  }

  rename(workspaceId: string, title: string): Promise<void> {
    return this.enqueue(async () => {
      const item = this.workspace(workspaceId)
      const member = (await this.members()).find(m => m.workspaceId === workspaceId)
      if (member === undefined) throw new GroupFailure('workspace-group/not-ready', '工作区归属尚未就绪', 409)
      this.normal(member.groupId)
      const value = this.name(title)
      await this.checkName(member.groupId, value, workspaceId)
      await item.setTitle(value)
    })
  }

  remove(workspaceId: string): Promise<void> {
    return this.enqueue(async () => {
      const item = this.workspace(workspaceId)
      const member = (await this.members()).find(m => m.workspaceId === workspaceId)
      if (member === undefined) throw new GroupFailure('workspace-group/not-ready', '工作区归属尚未就绪', 409)
      await this.registry.delete(item.id)
      await this.db.query('delete from workspace_group_members where workspace_id = $1', [workspaceId])
      await this.db.query('update workspace_group_focus set workspace_id = null, session_id = null where workspace_id = $1', [workspaceId])
      await this.ensureDefault(member.groupId)
    })
  }

  focus(groupId: string, workspaceId: string | null, sessionId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.groups.has(groupId)) throw new GroupFailure('workspace-group/unknown', '没有这个工作区组', 404)
      const exists = await this.db.query('select id from console_session where id = $1', [sessionId])
      if (exists.rows.length === 0 || this.registry.archivedSessionIds.includes(sessionId)) throw new GroupFailure('workspace-group/session-unavailable', '会话不存在或已归档', 409)
      const item = this.registry.list().find(w => w.sessionIds.includes(sessionId))
      const actual = item === undefined ? UNASSIGNED_GROUP_ID : (await this.members()).find(m => m.workspaceId === item.id)?.groupId
      if (actual !== groupId || (item?.id ?? null) !== workspaceId) throw new GroupFailure('workspace-group/focus-conflict', '会话已不属于目标工作区组', 409)
      await this.db.query(`insert into workspace_group_focus (group_id, workspace_id, session_id) values ($1, $2, $3)
        on conflict (group_id) do update set workspace_id = excluded.workspace_id, session_id = excluded.session_id`, [groupId, workspaceId, sessionId])
      if (item !== undefined) await this.db.query('update workspace_group_members set last_session_id = $2 where workspace_id = $1', [workspaceId, sessionId])
    })
  }

  /** Legacy callers must not silently claim a directory owned by a different group. */
  claim(workspaceId: string, groupId: string): Promise<{ ok: true }> {
    return this.enqueue(async () => { this.normal(groupId); await this.addCanonical(groupId, this.workspace(workspaceId).path); return { ok: true } })
  }

  private normal(id: string): Extract<RegisteredGroup, { kind: 'normal' }> {
    const group = this.groups.get(id)
    if (group === undefined) throw new GroupFailure('workspace-group/unknown', '没有这个工作区组', 404)
    if (group.kind === 'system') throw new GroupFailure('workspace-group/system-readonly', '「未归属」不能添加或创建工作区', 409)
    return group
  }
  private workspace(id: string): WorkspaceRecord {
    const item = this.registry.get(id)
    if (item === undefined) throw new GroupFailure('workspace-group/workspace-missing', '工作区已不存在', 404)
    return item
  }
  private name(value: string): string {
    const title = value.trim()
    if (title === '' || title.length > 200 || title.includes('\0')) throw new GroupFailure('workspace-group/invalid-name', '工作区名称不能为空且不能超过 200 字符')
    return title
  }
  private async checkName(groupId: string, title: string, except?: string): Promise<void> {
    const members = await this.members()
    const key = (name: string) => ['默认工作区', 'Default workspace', DEFAULT_WORKSPACE_TITLE].includes(name) ? DEFAULT_WORKSPACE_TITLE : name
    if (this.registry.list().some(w => w.id !== except && key(w.title) === key(title) && members.some(m => m.workspaceId === w.id && m.groupId === groupId))) {
      throw new GroupFailure('workspace-group/name-conflict', `本组已存在名为「${title}」的工作区`, 409)
    }
  }
  private async owner(path: string): Promise<DirectoryRow | undefined> {
    return (await this.db.query<DirectoryRow>('select directory, group_id, state from workspace_group_directories where directory = $1', [path])).rows[0]
  }
  private conflict(groupId: string, path: string): never {
    const item = this.registry.list().find(w => w.path === path)
    const label = this.groups.get(groupId)?.label ?? groupId
    throw new GroupFailure('workspace-group/directory-conflict', `该目录已属于「${label}」${item === undefined ? '' : `的「${item.title}」`}`, 409,
      { groupId, groupLabel: label, workspaceId: item?.id ?? null, workspaceTitle: item?.title ?? null })
  }
  private async addCanonical(groupId: string, path: string, proposed?: string): Promise<{ workspaceId: string; created: boolean }> {
    const owner = await this.owner(path)
    if (owner !== undefined && owner.group_id !== groupId) this.conflict(owner.group_id, path)
    const existing = this.registry.list().find(w => w.path === path)
    const membership = existing === undefined ? undefined : (await this.members()).find(m => m.workspaceId === existing.id)
    if (membership !== undefined && membership.groupId !== groupId) this.conflict(membership.groupId, path)
    if (existing !== undefined && membership !== undefined) return { workspaceId: existing.id, created: false }
    const title = this.name(proposed ?? existing?.title ?? basename(path))
    await this.checkName(groupId, title, existing?.id)
    await this.db.query(`insert into workspace_group_directories (directory, group_id, state) values ($1, $2, 'pending') on conflict (directory) do nothing`, [path, groupId])
    const reserved = await this.owner(path)
    if (reserved?.group_id !== groupId) this.conflict(reserved?.group_id ?? GENERAL_GROUP_ID, path)
    let item: WorkspaceRecord
    try { item = existing ?? await this.registry.create(path, title) } catch (cause) {
      if (owner === undefined && !this.registry.list().some(w => w.path === path)) await this.db.query("delete from workspace_group_directories where directory = $1 and state = 'pending'", [path])
      throw cause
    }
    await this.putMember(item, groupId)
    await this.db.query("update workspace_group_directories set state = 'ready' where directory = $1", [path])
    const histories = await this.db.query<{ id: string; header: { cwd?: string; origin?: string } }>('select id, header from console_session where header->>\'cwd\' = $1', [path])
    for (const row of histories.rows) {
      if (!this.registry.list().some(w => w.sessionIds.includes(row.id))) await item.attachSession(row.id)
    }
    return { workspaceId: item.id, created: existing === undefined }
  }
  private async putMember(item: WorkspaceRecord, groupId: string): Promise<void> {
    await this.db.query(`insert into workspace_group_members (workspace_id, group_id, directory) values ($1, $2, $3)
      on conflict (workspace_id) do nothing`, [item.id, groupId, item.path])
  }
  private async recover(): Promise<void> {
    const pending = await this.db.query<DirectoryRow>("select directory, group_id, state from workspace_group_directories where state = 'pending'")
    for (const row of pending.rows) {
      const item = this.registry.list().find(w => w.path === row.directory)
      if (item === undefined) await this.db.query("delete from workspace_group_directories where directory = $1 and state = 'pending'", [row.directory])
      else { await this.putMember(item, row.group_id); await this.db.query("update workspace_group_directories set state = 'ready' where directory = $1", [row.directory]) }
    }
  }
  private async reconcile(): Promise<void> {
    const items = this.registry.list()
    const members = await this.members()
    for (const member of members) {
      if (!items.some(w => w.id === member.workspaceId)) await this.db.query('delete from workspace_group_members where workspace_id = $1', [member.workspaceId])
    }
    for (const item of items) {
      if (members.some(m => m.workspaceId === item.id)) continue
      const owner = await this.owner(item.path)
      // Only an explicitly claimed directory joins a group. Unclaimed workspaces stay
      // unassigned; otherwise every workspace discovered on the host would appear in
      // the default group, including a second default-workspace.
      if (owner === undefined) continue
      await this.putMember(item, owner.group_id)
    }
    for (const group of this.groups.values()) if (group.kind === 'normal') await this.ensureDefault(group.id)
  }
  private async ensureDefault(groupId: string): Promise<void> {
    const group = this.normal(groupId)
    if ((await this.members()).some(m => m.groupId === groupId && m.isDefault && this.registry.get(m.workspaceId) !== undefined)) return
    const path = defaultWorkspacePath(group.path)
    await ensureDirectory(path)
    const canonical = await realpath(path)
    const result = await this.addCanonical(groupId, canonical, DEFAULT_WORKSPACE_TITLE)
    await this.db.query('update workspace_group_members set is_default = false where group_id = $1', [groupId])
    await this.db.query('update workspace_group_members set is_default = true where workspace_id = $1', [result.workspaceId])
  }
  private async members(): Promise<Member[]> {
    const result = await this.db.query<MemberRecord>('select workspace_id, group_id, directory, is_default, last_session_id from workspace_group_members')
    return result.rows.map(r => ({ workspaceId: r.workspace_id, groupId: r.group_id, directory: r.directory, isDefault: r.is_default, lastSessionId: r.last_session_id }))
  }
  private async focusRows(): Promise<Focus[]> {
    const result = await this.db.query<FocusRecord>('select group_id, workspace_id, session_id from workspace_group_focus')
    return result.rows.map(r => ({ groupId: r.group_id, workspaceId: r.workspace_id, sessionId: r.session_id }))
  }
}

export const generalGroup = { id: GENERAL_GROUP_ID, label: GENERAL_GROUP_LABEL,
  labelI18n: { zh: groupCopy('zh').general, en: groupCopy('en').general }, directory: '.smp/workspaces', order: 0 }
