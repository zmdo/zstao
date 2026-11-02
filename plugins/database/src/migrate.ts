import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'

const TABLE = 'console_schema_migrations'

/** SQL file names in the order they should run. */
export async function migrationFiles(directory: string): Promise<string[]> {
  const names = await readdir(directory)
  return names.filter((name) => name.endsWith('.sql')).sort()
}

/**
 * Apply SQL files that are not yet recorded.
 * The bookkeeping table belongs to this runner. Files start after the existing smp schema.
 * Returns the names applied during this call.
 */
export async function applyMigrations(pool: Pool, directory: string): Promise<string[]> {
  await pool.query(
    `create table if not exists ${TABLE} (
      id text primary key,
      applied_at timestamptz not null default now()
    )`,
  )
  const done = await pool.query<{ id: string }>(`select id from ${TABLE}`)
  const applied = new Set(done.rows.map((row) => row.id))
  const ran: string[] = []
  for (const name of await migrationFiles(directory)) {
    if (applied.has(name)) continue
    const sql = await readFile(join(directory, name), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query(`insert into ${TABLE} (id) values ($1)`, [name])
      await client.query('commit')
    } catch (cause) {
      await rollback(client)
      throw cause
    } finally {
      client.release()
    }
    ran.push(name)
  }
  return ran
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback')
  } catch (error) {
    // The connection may already be dead. The original failure is the one to throw.
    void error
  }
}
