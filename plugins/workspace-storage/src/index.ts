import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { Pool } from 'pg'
import { PostgresStorageBackend } from './backend.ts'

interface DatabaseService {
  pool: Pool
}

export interface Config {
  /** Directory of existing JSON units. An absent database unit is filled from `<importRoot>/<name>.json` once. */
  importRoot: string
}

export const Config: Schema<Config> = Schema.object({
  importRoot: String,
})

export const inject = ['database', 'storage']

const BACKEND = 'postgres'

/**
 * Register the `postgres` storage backend. `storage-domain` routes the
 * `workspace` domain here, so workspace records are not written as JSON.
 */
export function apply(ctx: Context, config: Config): void {
  const database = (ctx as Context & { database: DatabaseService }).database
  const backend = new PostgresStorageBackend(database.pool, config.importRoot)
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register(BACKEND, backend)
    return async () => {
      unregister()
      await backend.close()
    }
  })
  ctx.provide(storageBackendServiceKey(BACKEND), backend)
}
