import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'

/**
 * Serializes appends for one write handle. Live events arrive one at a time;
 * a flush waits until every event queued before it has committed.
 */
export class WriterQueue {
  private readonly pending: SessionEvent[] = []
  private draining: Promise<void> | undefined
  private readonly handle: SessionHandle

  constructor(handle: SessionHandle) {
    this.handle = handle
  }

  enqueue(event: SessionEvent, onError?: (error: unknown) => void): void {
    this.pending.push(event)
    const run = this.kick()
    if (onError !== undefined) void run.catch(onError)
  }

  async flush(): Promise<void> {
    await this.kick()
    if (this.pending.length > 0) await this.kick()
    await this.handle.flush()
  }

  private kick(): Promise<void> {
    if (this.draining !== undefined) return this.draining
    this.draining = this.run().finally(() => {
      this.draining = undefined
      if (this.pending.length > 0) this.kick()
    })
    return this.draining
  }

  private async run(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, this.pending.length)
      try {
        await this.handle.append(batch)
      } catch (error) {
        this.pending.unshift(...batch)
        throw error
      }
    }
  }
}
