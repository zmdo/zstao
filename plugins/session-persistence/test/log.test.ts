import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistenceNotFoundError,
  SessionReadOnlyError,
} from '@deepseek-ai/dsh-session-persistence'
import { Pool } from 'pg'
import { SessionLog } from '../src/log.ts'
import { WriterQueue } from '../src/route.ts'
import { PostgresSessionTable } from '../src/postgres.ts'
import type { SessionMeta, SessionSlice, SessionTable } from '../src/table.ts'

function header(id: string, seeded = false): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1_700_000_000_000,
    isSeeded: seeded,
  }
}

function turn(seq: number): SessionEvent {
  return {
    type: 'turn/start',
    seq: SessionSeq(seq),
    time: 1_700_000_000_000 + seq,
    data: { turn: seq },
  }
}

class MemoryTable implements SessionTable {
  private readonly rows = new Map<string, { meta: SessionMeta, events: SessionEvent[] }>()

  async create(row: Pick<SessionMeta, 'id' | 'header' | 'inheritedEventCount'>): Promise<boolean> {
    if (this.rows.has(row.id)) return false
    this.rows.set(row.id, {
      meta: { ...row, revision: 0, eventCount: 0 },
      events: [],
    })
    return true
  }

  async load(id: string): Promise<SessionMeta | undefined> {
    const row = this.rows.get(id)
    return row === undefined ? undefined : { ...row.meta, header: row.meta.header }
  }

  async read(id: string, offset: number, length: number | undefined): Promise<SessionSlice | undefined> {
    const row = this.rows.get(id)
    if (row === undefined) return undefined
    const available = Math.max(0, row.meta.eventCount - offset)
    const limit = length === undefined ? available : Math.min(length, available)
    const events = row.events.filter((event) => event.seq >= offset).slice(0, limit).map((event) => structuredClone(event))
    return { eventCount: row.meta.eventCount, events }
  }

  async append(id: string, events: SessionEvent[]): Promise<SessionMeta> {
    const row = this.rows.get(id)
    if (row === undefined) throw new Error(`session "${id}" disappeared before append`)
    if (events[0]?.seq !== row.meta.eventCount) {
      throw new Error(`append seq mismatch for "${id}"`)
    }
    row.events.push(...events.map((event) => structuredClone(event)))
    row.meta = {
      ...row.meta,
      eventCount: row.meta.eventCount + events.length,
      revision: row.meta.revision + 1,
    }
    return { ...row.meta }
  }

  async list(): Promise<SessionMeta[]> {
    return [...this.rows.values()].map((row) => ({ ...row.meta }))
  }
}

test('a session is created, appended, and read back', async () => {
  const log = new SessionLog(new MemoryTable())
  const handle = await log.create(header('session-a'))
  await handle.append([turn(0), turn(1)])
  await handle.flush()
  const slice = await handle.read()
  assert.equal(slice.events.length, 2)
  assert.equal(slice.events[1]?.seq, 1)
  assert.equal(slice.eventState, 'shared-frozen')
  const stat = await log.stat(SessionId('session-a'))
  assert.equal(stat?.eventCount, 2)
  assert.equal(stat?.revision, 'session-a:1')
  assert.equal(stat?.formatStatus, 'current')
  await handle.close()
  const again = await log.stat(SessionId('session-a'))
  assert.equal(again?.revision, 'session-a:1')
})

test('write ownership is single and a read handle cannot append', async () => {
  const log = new SessionLog(new MemoryTable())
  const writer = await log.create(header('session-b'))
  const reader = await log.open(SessionId('session-b'), 'read')
  await assert.rejects(() => log.open(SessionId('session-b'), 'write'), SessionAlreadyOwnedError)
  await assert.rejects(() => reader.append([turn(0)]), SessionReadOnlyError)
  await writer.append([turn(0)])
  const seen = await reader.read()
  assert.equal(seen.events.length, 1)
  await writer.close()
  const next = await log.open(SessionId('session-b'), 'write')
  await next.close()
})

test('create refuses a duplicate and a missing session', async () => {
  const log = new SessionLog(new MemoryTable())
  const handle = await log.create(header('session-c'))
  await assert.rejects(() => log.create(header('session-c')), SessionAlreadyExistsError)
  await handle.close()
  await assert.rejects(() => log.create(header('session-c')), SessionAlreadyExistsError)
  await assert.rejects(() => log.open(SessionId('missing'), 'read'), SessionPersistenceNotFoundError)
  assert.equal(await log.stat(SessionId('missing')), undefined)
})

test('seeded headers require an inherited count and unseeded headers refuse one', async () => {
  const log = new SessionLog(new MemoryTable())
  await assert.rejects(
    () => log.create(header('session-seed', true)),
    /seeded session header requires an inherited event count/,
  )
  await assert.rejects(
    () => log.create(header('session-plain'), { inheritedEventCount: SessionLogOffset(2) }),
    /unseeded session header inherited event count must be 0/,
  )
  const seeded = await log.create(header('session-seed', true), { inheritedEventCount: SessionLogOffset(2) })
  assert.equal(seeded.inheritedEventCount, 2)
  await seeded.close()
})

test('a closed handle rejects later calls and an empty append does not change the revision', async () => {
  const log = new SessionLog(new MemoryTable())
  const handle = await log.create(header('session-d'))
  await handle.append([])
  await handle.close()
  assert.equal((await log.stat(SessionId('session-d')))?.revision, 'session-d:0')
  await assert.rejects(() => handle.read(), SessionHandleClosedError)
})

test('live events commit in order when the write queue flushes', async () => {
  const log = new SessionLog(new MemoryTable())
  const handle = await log.create(header('session-q'))
  const queue = new WriterQueue(handle)
  queue.enqueue(turn(0))
  queue.enqueue(turn(1))
  await queue.flush()
  const slice = await handle.read()
  assert.deepEqual(slice.events.map((event) => event.seq), [0, 1])
  await handle.close()
})

test('postgres stores the log and a second append continues it', async (t) => {
  const databaseUrl = databaseUrlFromProfile()
  if (databaseUrl === undefined) {
    t.skip('the local database url is not configured')
    return
  }
  const pool = new Pool({ connectionString: databaseUrl })
  await pool.query(readFileSync(new URL('../../database/migrations/0006_session_log.sql', import.meta.url), 'utf8'))
  const log = new SessionLog(new PostgresSessionTable(pool))
  const id = SessionId(`session-probe-${Date.now()}`)
  t.after(async () => {
    await pool.query('delete from console_session_event where session_id = $1', [id])
    await pool.query('delete from console_session where id = $1', [id])
    await pool.end()
  })
  const handle = await log.create(header(id))
  await handle.append([turn(0)])
  await handle.flush()
  await handle.close()
  const reopened = await log.open(id, 'read')
  const slice = await reopened.read()
  assert.equal(slice.events.length, 1)
  assert.equal(slice.events[0]?.type, 'turn/start')
  const listed = await log.list()
  assert.equal(listed.some((item) => item.header.id === id), true)
  await reopened.close()
})

function databaseUrlFromProfile(): string | undefined {
  try {
    const text = readFileSync(new URL('../../../tmp/dsh-home/profiles/web/cordis.patch.yml', import.meta.url), 'utf8')
    const match = text.match(/databaseUrl:\s*(\S+)/)
    return match?.[1]?.replace(/,+$/, '')
  } catch {
    return undefined
  }
}
