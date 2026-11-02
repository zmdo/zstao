import type { GroupSnapshot, SessionSnapshot, WorkspaceSnapshot } from './contract.ts'
import { groupForSession } from './rules.ts'

/** Resolve ownership against the complete registry before narrowing either native list. */
export function sidebarProjection(groupId: string, groups: GroupSnapshot, workspaces: WorkspaceSnapshot, sessions: SessionSnapshot) {
  const items = workspaces.items.filter(w => groups.members.some(m => m.workspaceId === w.workspaceId && m.groupId === groupId))
  const byId = Object.fromEntries(Object.entries(sessions.byId).filter(([id]) => groupForSession(id, workspaces.items, groups.members) === groupId))
  return {
    workspaces: { ...workspaces, items },
    sessions: { ...sessions, ids: sessions.ids.filter(id => byId[id] !== undefined), byId },
  }
}
