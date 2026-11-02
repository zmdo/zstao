import { Pool } from 'pg'
import { normalizeDatabaseUrl } from './url.ts'

const CONNECT_TIMEOUT_MS = 5_000

/**
 * Open a short-lived pool and run `select 1`.
 * Failures stay generic: the driver message can contain the connection string.
 */
export async function databaseReachable(databaseUrl: string): Promise<string | undefined> {
  let connectionString: string
  try {
    connectionString = normalizeDatabaseUrl(databaseUrl)
  } catch (cause) {
    void cause
    return 'databaseUrl 必须是 PostgreSQL 地址'
  }
  const pool = new Pool({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS })
  try {
    await pool.query('select 1')
    return undefined
  } catch (cause) {
    void cause
    return '数据库连不上'
  } finally {
    await pool.end()
  }
}
