import type { Focus, Member, Session, Workspace } from './contract.ts'
import { groupForSession, UNASSIGNED_GROUP_ID } from './rules.ts'

export type Destination = { kind: 'session'; sessionId: string } | { kind: 'workspace'; workspaceId: string } | { kind: 'empty' }

export function restoration(groupId: string, workspaces: readonly Workspace[], members: readonly Member[], sessions: Readonly<Record<string, Session>>, archived: readonly string[], focus?: Focus, workspaceId?: string): Destination {
  const valid = (id: string | null | undefined): id is string => {
    if (id == null) return false
    const session = sessions[id]
    return session !== undefined && session.origin !== 'subagent' && !archived.includes(id)
      && groupForSession(id, workspaces, members) === groupId
      && (workspaceId === undefined || workspaces.some(w => w.workspaceId === workspaceId && w.sessionIds.includes(id)))
  }
  if (workspaceId === undefined && valid(focus?.sessionId)) return { kind: 'session', sessionId: focus.sessionId }
  const item = workspaces.find(w => w.workspaceId === (workspaceId ?? focus?.workspaceId) && members.some(m => m.workspaceId === w.workspaceId && m.groupId === groupId))
  const member = members.find(m => m.workspaceId === item?.workspaceId)
  if (item !== undefined && valid(member?.lastSessionId)) return { kind: 'session', sessionId: member.lastSessionId }
  const candidates = Object.values(sessions).filter(s => valid(s.id) && !s.blank && (groupId === UNASSIGNED_GROUP_ID || item?.sessionIds.includes(s.id)))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id))
  if (candidates[0] !== undefined) return { kind: 'session', sessionId: candidates[0].id }
  if (workspaceId !== undefined && item !== undefined) return { kind: 'workspace', workspaceId }
  const fallback = members.find(m => m.groupId === groupId && m.isDefault && workspaces.some(w => w.workspaceId === m.workspaceId))
  return fallback === undefined ? { kind: 'empty' } : { kind: 'workspace', workspaceId: fallback.workspaceId }
}

/** Only the newest user navigation may publish state after an awaited operation. */
export class NavigationEpoch {
  private value = 0
  begin(): number { return ++this.value }
  current(epoch: number): boolean { return epoch === this.value }
}
