export interface ListSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export type GroupLabelI18n = Readonly<Partial<Record<'zh' | 'en', string>>>

export interface GroupLabel {
  label: string
  labelI18n?: GroupLabelI18n
}

export interface NormalGroup extends GroupLabel {
  kind: 'normal'
  id: string
  directory: string
  path: string
  order: number
}

export interface SystemGroup extends GroupLabel {
  kind: 'system'
  id: 'unassigned'
  order: number
}

export type RegisteredGroup = NormalGroup | SystemGroup

export interface Member {
  workspaceId: string
  groupId: string
  directory: string
  isDefault: boolean
  lastSessionId: string | null
}

export interface Focus {
  groupId: string
  workspaceId: string | null
  sessionId: string | null
}

export interface Allow {
  id: string
  groups: string[]
  pages: string[]
}

export interface GroupSnapshot {
  testResetEpoch?: string
  groups: RegisteredGroup[]
  members: Member[]
  focus: Focus[]
  allows: Allow[]
}

export interface Workspace {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
  createdAt?: string
}

export interface WorkspaceSnapshot {
  phase?: 'pending' | 'ready'
  state?: string
  items: readonly Workspace[]
  archivedSessionIds: readonly string[]
  pinnedSessionIds: readonly string[]
}

export interface Session {
  id: string
  cwd?: string
  title?: string
  displayTitle?: string
  origin?: string
  parentId?: string
  blank?: boolean
  running?: boolean
  updatedAt?: number
  retainedBy?: { mainView?: number }
}

export interface SessionSnapshot {
  phase?: 'pending' | 'ready'
  ids: readonly string[]
  byId: Record<string, Session>
}

export interface ConflictOwner {
  groupId: string
  groupLabel: string
  workspaceId: string | null
  workspaceTitle: string | null
}

export class GroupFailure extends Error {
  readonly code: string
  readonly status: number
  readonly owner?: ConflictOwner
  constructor(code: string, message: string, status = 400, owner?: ConflictOwner, options?: ErrorOptions) {
    super(message, options)
    this.code = code; this.status = status; this.owner = owner
  }
}
