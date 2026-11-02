import type { Db } from '../../database/connection.ts'

export function lockCatalog(db: Db) {
  return db.query<never>("select pg_advisory_xact_lock(hashtextextended('smp/server-management/catalog', 0))")
}
