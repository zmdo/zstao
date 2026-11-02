import { assertContiguous } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { Pool, PoolClient } from 'pg'
import type { SessionMeta, SessionSlice, SessionTable } from './table.ts'

interface SessionRow {
  id: string
  header: SessionHeader
  inherited_event_count: number
  revision: number
  event_count: number
}

/**
 * Session rows in the console database. Callers hold the pool from `database`.
 */
export class PostgresSessionTable implements SessionTable {
  private readonly pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async create(row: Pick<SessionMeta, 'id' | 'header' | 'inheritedEventCount'>): Promise<boolean> {
    const inserted = await this.pool.query(
      `insert into console_session (id, header, inherited_event_count, revision, event_count)
       values ($1, $2::jsonb, $3, 0, 0)
       on conflict (id) do nothing
       returning id`,
      [row.id, JSON.stringify(row.header), row.inheritedEventCount],
    )
    return (inserted.rowCount ?? 0) > 0
  }

  async load(id: string): Promise<SessionMeta | undefined> {
    const result = await this.pool.query<SessionRow>(
      `select id, header, inherited_event_count, revision, event_count
       from console_session where id = $1`,
      [id],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : metaOf(row)
  }

  async read(id: string, offset: number, length: number | undefined): Promise<SessionSlice | undefined> {
    return this.transaction(async (client) => {
      const meta = await client.query<{ event_count: number }>(
        'select event_count from console_session where id = $1',
        [id],
      )
      const row = meta.rows[0]
      if (row === undefined) return undefined
      const available = Math.max(0, row.event_count - offset)
      const limit = length === undefined ? available : Math.min(length, available)
      if (limit === 0) return { eventCount: row.event_count, events: [] }
      const events = await client.query<{ event: SessionEvent }>(
        `select event from console_session_event
         where session_id = $1 and seq >= $2
         order by seq
         limit $3`,
        [id, offset, limit],
      )
      return { eventCount: row.event_count, events: events.rows.map((item) => item.event) }
    })
  }

  async append(id: string, events: SessionEvent[]): Promise<SessionMeta> {
    return this.transaction(async (client) => {
      const current = await client.query<SessionRow>(
        `select id, header, inherited_event_count, revision, event_count
         from console_session where id = $1 for update`,
        [id],
      )
      const row = current.rows[0]
      if (row === undefined) {
        throw new Error(`session "${id}" disappeared before append`)
      }
      assertContiguous(row.header.id, events, row.event_count)
      for (const event of events) {
        await client.query(
          `insert into console_session_event (session_id, seq, event)
           values ($1, $2, $3::jsonb)`,
          [id, event.seq, JSON.stringify(event)],
        )
      }
      const updated = await client.query<SessionRow>(
        `update console_session
         set event_count = event_count + $2, revision = revision + 1
         where id = $1
         returning id, header, inherited_event_count, revision, event_count`,
        [id, events.length],
      )
      const next = updated.rows[0]
      if (next === undefined) throw new Error(`session "${id}" disappeared during append`)
      return metaOf(next)
    })
  }

  async list(): Promise<SessionMeta[]> {
    const result = await this.pool.query<SessionRow>(
      `select id, header, inherited_event_count, revision, event_count
       from console_session order by id`,
    )
    return result.rows.map(metaOf)
  }

  private async transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const value = await body(client)
      await client.query('commit')
      return value
    } catch (cause) {
      try {
        await client.query('rollback')
      } catch (rollbackError) {
        void rollbackError
      }
      throw cause
    } finally {
      client.release()
    }
  }
}

function metaOf(row: SessionRow): SessionMeta {
  return {
    id: row.id,
    header: row.header,
    inheritedEventCount: row.inherited_event_count,
    revision: row.revision,
    eventCount: row.event_count,
  }
}
