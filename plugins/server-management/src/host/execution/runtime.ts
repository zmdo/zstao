import { randomUUID } from 'node:crypto'
import { type Db } from '../database/connection.ts'
import { DefinitionRegistry } from '../definitions/registry.ts'
import type { ServerExtensionRegistry } from '../extensions/registry.ts'
import { connectSsh } from '../remote/ssh.ts'
import { scheduleChanges } from '../upgrades/scheduler.ts'
import { dueInspects } from './persistence/inspection-repository.ts'
import { claimNext, enqueue } from './queue.ts'
import { executeJob } from './worker.ts'

const WORKERS = 4

export function startJobs(
  ctx: { logger: { error(cause: unknown): void }; secrets: { decrypt(ciphertext: string): string } },
  db: Db,
  config: { inspectIntervalSeconds: number; updateCheckIntervalSeconds: number },
  definitions: DefinitionRegistry,
  connect: typeof connectSsh,
  extensions?: ServerExtensionRegistry,
): () => Promise<void> {
  const workerId = randomUUID()
  let stopped = false
  let pumping = false
  let active = 0
  const tasks = new Set<Promise<void>>()
  const loops = new Set<Promise<void>>()
  const launch = (run: () => Promise<void>) => {
    const task = run()
      .catch((cause: unknown) => {
        ctx.logger.error(cause)
      })
      .finally(() => {
        loops.delete(task)
      })
    loops.add(task)
  }
  const claim = setInterval(() => {
    launch(pump)
  }, 400)
  const inspect = setInterval(() => {
    launch(queueInspects)
    launch(() => scheduleChanges(db, config.updateCheckIntervalSeconds))
  }, 5000)
  launch(pump)
  launch(() => scheduleChanges(db, config.updateCheckIntervalSeconds))
  return async () => {
    stopped = true
    clearInterval(claim)
    clearInterval(inspect)
    await Promise.all(loops)
    await Promise.all(tasks)
  }

  async function pump(): Promise<void> {
    if (pumping || stopped) return
    pumping = true
    try {
      while (!stopped && active < WORKERS) {
        const job = await claimNext(db, workerId)
        if (job === undefined) return
        active += 1
        const task = executeJob(db, ctx.secrets, definitions, job, connect, config.updateCheckIntervalSeconds, extensions)
          .catch((cause: unknown) => {
            ctx.logger.error(cause)
          })
          .finally(() => {
            active -= 1
            tasks.delete(task)
          })
        tasks.add(task)
      }
    } finally {
      pumping = false
    }
  }

  async function queueInspects(): Promise<void> {
    if (stopped) return
    const ids = await dueInspects(db, config.inspectIntervalSeconds)
    for (const id of ids) {
      if (stopped) return
      await enqueue(db, id, 'inspect', undefined, false, 'scheduled')
    }
  }
}
