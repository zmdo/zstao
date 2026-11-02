import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pool } from 'pg'
import { applyMigrations, migrationFiles } from '../src/migrate.ts'

test('migration files run in name order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'database-'))
  await writeFile(join(directory, 'notes.txt'), '')
  await writeFile(join(directory, '0002_b.sql'), 'select 1')
  await writeFile(join(directory, '0001_a.sql'), 'select 1')
  assert.deepEqual(await migrationFiles(directory), ['0001_a.sql', '0002_b.sql'])
})

test('migrations record themselves and do not run twice', async (t) => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') {
    t.skip('DATABASE_URL is not set')
    return
  }
  const directory = await mkdtemp(join(tmpdir(), 'database-'))
  await writeFile(join(directory, '0001_probe.sql'), 'select 1')
  const pool = new Pool({ connectionString: databaseUrl })
  t.after(() => pool.end())
  const first = await applyMigrations(pool, directory)
  const second = await applyMigrations(pool, directory)
  assert.deepEqual(first, ['0001_probe.sql'])
  assert.deepEqual(second, [])
  await pool.query('delete from console_schema_migrations where id = $1', ['0001_probe.sql'])
})

test('a failing migration leaves no record', async (t) => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl === '') {
    t.skip('DATABASE_URL is not set')
    return
  }
  const directory = await mkdtemp(join(tmpdir(), 'database-'))
  await writeFile(join(directory, '0001_bad.sql'), 'select * from console_store_missing_relation')
  const pool = new Pool({ connectionString: databaseUrl })
  t.after(() => pool.end())
  await assert.rejects(() => applyMigrations(pool, directory))
  const rows = await pool.query('select id from console_schema_migrations where id = $1', ['0001_bad.sql'])
  assert.equal(rows.rowCount, 0)
})
