import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import { SESSION_FORMAT_VERSION, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import type { SessionMeta, SessionTable } from './table.ts'

/**
 * In-process session log over a {@link SessionTable}. Append commits in the
 * table, so flush only confirms the handle is still the writer.
 */
export class SessionLog {
  private readonly owners = new Map<string, LogHandle>()
  private readonly table: SessionTable

  constructor(table: SessionTable) {
    this.table = table
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    const inherited = inheritedCount(snapshot, options?.inheritedEventCount)
    options?.signal?.throwIfAborted()
    if (this.owners.has(snapshot.id)) throw new SessionAlreadyExistsError(snapshot.id)
    const created = await this.table.create({
      id: snapshot.id,
      header: snapshot,
      inheritedEventCount: inherited,
    })
    if (!created || this.owners.has(snapshot.id)) throw new SessionAlreadyExistsError(snapshot.id)
    const handle = new LogHandle(this, this.table, snapshot.id, snapshot, 'write', SessionLogOffset(inherited), 0)
    this.owners.set(snapshot.id, handle)
    return handle
  }

  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    if (access === 'write' && this.owners.has(id)) throw new SessionAlreadyOwnedError(id)
    const meta = await this.require(id)
    options?.signal?.throwIfAborted()
    if (access === 'write' && this.owners.has(id)) throw new SessionAlreadyOwnedError(id)
    const handle = new LogHandle(
      this,
      this.table,
      id,
      meta.header,
      access,
      SessionLogOffset(meta.inheritedEventCount),
      meta.eventCount,
    )
    if (access === 'write') this.owners.set(id, handle)
    return handle
  }

  async flush(): Promise<void> {
    const handles = [...this.owners.values()]
    const failures: Error[] = []
    await Promise.all(handles.map(async (handle) => {
      try {
        await handle.flush()
      } catch (error) {
        if (error instanceof SessionHandleClosedError) return
        failures.push(error instanceof Error ? error : new Error(String(error)))
      }
    }))
    if (failures.length > 0) throw new AggregateError(failures, 'session flush failed')
  }

  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const meta = await this.table.load(id)
    return meta === undefined ? undefined : snapshotOf(meta)
  }

  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    options?.signal?.throwIfAborted()
    const rows = await this.table.list()
    return rows.map(snapshotOf)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.owners.values()].map((handle) => handle.close()))
  }

  release(handle: LogHandle): void {
    if (this.owners.get(handle.id) === handle) this.owners.delete(handle.id)
  }

  private async require(id: SessionId): Promise<SessionMeta> {
    const meta = await this.table.load(id)
    if (meta === undefined) throw new SessionPersistenceNotFoundError(id)
    assertStoredId(id, meta.header)
    assertVersion(meta.header)
    return meta
  }
}

class LogHandle implements SessionHandle {
  private closed = false
  private seen: number
  private readonly log: SessionLog
  private readonly table: SessionTable
  readonly id: SessionId
  readonly header: SessionHeader
  readonly access: SessionAccess
  readonly inheritedEventCount: SessionLogOffsetType

  constructor(
    log: SessionLog,
    table: SessionTable,
    id: SessionId,
    header: SessionHeader,
    access: SessionAccess,
    inheritedEventCount: SessionLogOffsetType,
    eventCount: number,
  ) {
    this.log = log
    this.table = table
    this.id = id
    this.header = header
    this.access = access
    this.inheritedEventCount = inheritedEventCount
    this.seen = eventCount
  }

  async read(offset = 0, length?: number, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    options?.signal?.throwIfAborted()
    assertRange(offset, 'offset')
    if (length !== undefined) assertRange(length, 'length')
    const slice = await this.table.read(this.id, offset, length)
    if (slice === undefined) throw new SessionPersistenceNotFoundError(this.id)
    if (slice.eventCount < this.seen) {
      throw new SessionPersistenceCorruptionError(`session "${this.id}" log shrank`, {})
    }
    const available = Math.max(0, slice.eventCount - offset)
    const expected = length === undefined ? available : Math.min(length, available)
    if (slice.events.length !== expected || (slice.events.length > 0 && slice.events[0]?.seq !== offset)) {
      throw new SessionPersistenceCorruptionError(`session "${this.id}" log has a gap`, {})
    }
    const events = validateStoredEvents(this.header, slice.events)
    this.seen = slice.eventCount
    return { eventState: 'shared-frozen', events }
  }

  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    options?.signal?.throwIfAborted()
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
    const batch = [...materializeAppendBatch(events)]
    if (batch.length === 0) return
    const stored = validateStoredEvents(this.header, batch)
    try {
      const meta = await this.table.append(this.id, stored)
      this.seen = meta.eventCount
    } catch (error) {
      if (error instanceof Error && error.message.includes('disappeared')) {
        throw new SessionPersistenceNotFoundError(this.id)
      }
      throw error
    }
  }

  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    this.assertOpen('flush')
    options?.signal?.throwIfAborted()
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.access === 'write') this.log.release(this)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private assertOpen(operation: string): void {
    if (this.closed) throw new SessionHandleClosedError(this.id, operation)
  }
}

function inheritedCount(header: SessionHeader, value: number | undefined): number {
  if (header.isSeeded && value === undefined) {
    throw new Error('seeded session header requires an inherited event count')
  }
  const cut = value ?? 0
  if (!Number.isSafeInteger(cut) || cut < 0) {
    throw new TypeError('inherited event count must be a non-negative safe integer')
  }
  if (!header.isSeeded && cut !== 0) {
    throw new Error('unseeded session header inherited event count must be 0')
  }
  return cut
}

function snapshotOf(meta: SessionMeta): SessionPersistenceSnapshot {
  return {
    header: meta.header,
    formatStatus: meta.header.version === SESSION_FORMAT_VERSION ? 'current' : 'migration-required',
    revision: SessionPersistenceRevision(`${meta.id}:${meta.revision}`),
    eventCount: meta.eventCount,
  }
}

function assertRange(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
}
