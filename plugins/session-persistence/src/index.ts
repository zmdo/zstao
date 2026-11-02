import { Context } from '@deepseek-ai/cordis'
import { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { Pool } from 'pg'
import { SessionLog } from './log.ts'
import { PostgresSessionTable } from './postgres.ts'
import { WriterQueue } from './route.ts'

interface DatabaseService {
  pool: Pool
}

export const inject = ['database']

/**
 * Registers `sessionPersistence` on the console database. The jsonl backend
 * is disabled by this plugin's patch, so new events are not written as files.
 */
export class PostgresSessionPersistence extends SessionPersistence {
  private readonly log: SessionLog
  private readonly writers = new Map<string, { queue: WriterQueue, handle: SessionHandle }>()

  constructor(ctx: Context, pool: Pool) {
    super(ctx)
    this.log = new SessionLog(new PostgresSessionTable(pool))
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    const handle = await this.log.create(header, options)
    return this.track(handle)
  }

  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const handle = await this.log.open(id, access, options)
    return access === 'write' ? this.track(handle) : handle
  }

  /** Accept one live event. Ordering is kept until the next flush. */
  enqueue(id: string, event: SessionEvent): void {
    const writer = this.writers.get(id)
    if (writer === undefined) return
    writer.queue.enqueue(event, (error) => {
      this.ctx.logger.warn(`会话 "${id}" 写入数据库失败：${String(error)}`)
    })
  }

  /** Commit events queued for one live session. */
  drain(id: string): Promise<void> {
    const writer = this.writers.get(id)
    return writer === undefined ? Promise.resolve() : writer.queue.flush()
  }

  /** Flush and drop the write handle when the live session goes away. */
  release(id: string): Promise<void> {
    const writer = this.writers.get(id)
    return writer === undefined ? Promise.resolve() : writer.handle.close()
  }

  flush(): Promise<void> {
    return this.log.flush()
  }

  stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    return this.log.stat(id, options)
  }

  list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    return this.log.list(options)
  }

  async closeAll(): Promise<void> {
    const writers = [...this.writers.values()]
    await Promise.all(writers.map(async (writer) => {
      try {
        await writer.handle.close()
      } catch (error) {
        this.ctx.logger.warn(`会话写入数据库失败：${String(error)}`)
      }
    }))
    await this.log.closeAll()
  }

  private track(handle: SessionHandle): SessionHandle {
    const queue = new WriterQueue(handle)
    this.writers.set(handle.id, { queue, handle })
    const close = handle.close.bind(handle)
    handle.close = async () => {
      this.writers.delete(handle.id)
      await queue.flush()
      await close()
    }
    return handle
  }
}

export async function* apply(ctx: Context): AsyncGenerator<() => Promise<void>> {
  const database = (ctx as Context & { database: DatabaseService }).database
  const service = new PostgresSessionPersistence(ctx, database.pool)
  yield () => service.closeAll()
  // Live events are not written by the caller. The session store publishes
  // them, and this listener is what used to live in the jsonl backend.
  yield ctx.on('session/event', (session: { id: string }, event: SessionEvent) => {
    service.enqueue(session.id, event)
  })
  yield ctx.on('session/flush', (session: { id: string }) => service.drain(session.id))
  yield ctx.on('session/disposed', (session: { id: string }) => {
    service.release(session.id).then(() => undefined, (error: unknown) => {
      ctx.logger.warn(`会话 "${session.id}" 结束时写入数据库失败：${String(error)}`)
    })
  })
}
