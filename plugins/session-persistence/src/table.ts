import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

/** One stored session, without its event bodies. */
export interface SessionMeta {
  id: string
  header: SessionHeader
  inheritedEventCount: number
  revision: number
  eventCount: number
}

/** A slice of a stored log and the count it was read against. */
export interface SessionSlice {
  eventCount: number
  events: SessionEvent[]
}

/**
 * Append-only session rows. `append` and `read` each run as one
 * transaction so a crash cannot leave a torn batch.
 */
export interface SessionTable {
  create(row: Pick<SessionMeta, 'id' | 'header' | 'inheritedEventCount'>): Promise<boolean>
  load(id: string): Promise<SessionMeta | undefined>
  read(id: string, offset: number, length: number | undefined): Promise<SessionSlice | undefined>
  append(id: string, events: SessionEvent[]): Promise<SessionMeta>
  list(): Promise<SessionMeta[]>
}
