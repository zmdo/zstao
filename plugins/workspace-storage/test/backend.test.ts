import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { Pool } from 'pg'
import { PostgresStorageBackend } from '../src/backend.ts'

test('records and the global slot round-trip', async (t) => {
  const pool = await openPool(t, 'probe_round')
  if (pool === undefined) return
  const backend = new PostgresStorageBackend(pool, '')
  t.after(() => backend.close())
  const unit = await backend.kv.open(descriptor('probe_round'))
  const empty = await unit.loadAll()
  assert.deepEqual(empty.tables.workspaces, {})
  assert.equal(empty.global, null)
  await unit.putRecord('workspaces', 'w1', { title: '默认' })
  await unit.setGlobal({ initialized: true, workspaceIds: ['w1'] })
  const stored = await unit.loadAll()
  assert.deepEqual(stored.tables.workspaces?.w1, { title: '默认' })
  assert.deepEqual(stored.global, { initialized: true, workspaceIds: ['w1'] })
  await unit.deleteRecord('workspaces', 'w1')
  const cleared = await unit.loadAll()
  assert.deepEqual(cleared.tables.workspaces, {})
  await unit.close()
})

test('an existing json unit is imported once and later file edits are ignored', async (t) => {
  const pool = await openPool(t, 'probe_import')
  if (pool === undefined) return
  const root = await mkdtemp(join(tmpdir(), 'workspace-storage-'))
  const file = join(root, 'probe_import.json')
  await writeFile(file, JSON.stringify({
    unit: { name: 'probe_import', version: 2 },
    global: { initialized: true },
    tables: { workspaces: { w1: { title: 'imported' } } },
  }))
  const before = await stat(file)
  const backend = new PostgresStorageBackend(pool, root)
  t.after(() => backend.close())
  const unit = await backend.kv.open(descriptor('probe_import'))
  const imported = await unit.loadAll()
  assert.deepEqual(imported.tables.workspaces?.w1, { title: 'imported' })
  const after = await stat(file)
  assert.equal(after.mtimeMs, before.mtimeMs)
  await writeFile(file, '{"unit":{"name":"probe_import","version":2},"global":null,"tables":{"workspaces":{}}}')
  await unit.close()
  const again = await backend.kv.open(descriptor('probe_import'))
  const kept = await again.loadAll()
  assert.deepEqual(kept.tables.workspaces?.w1, { title: 'imported' })
  await again.close()
})

test('a stored version that is not current is refused', async (t) => {
  const name = 'probe_version'
  const pool = await openPool(t, name)
  if (pool === undefined) return
  await pool.query(
    'insert into console_storage_unit (name, version) values ($1, 1) on conflict (name) do update set version = 1',
    [name],
  )
  const backend = new PostgresStorageBackend(pool, '')
  t.after(() => backend.close())
  await assert.rejects(() => backend.kv.open(descriptor(name)), (error: unknown) => {
    assert.ok(error instanceof StorageError)
    assert.equal(error.code, 'version-mismatch')
    return true
  })
})

function descriptor(name: string): KvUnitDescriptor {
  return { name, version: 2, tables: ['workspaces'], hasGlobal: true }
}

async function openPool(t: test.TestContext, name: string): Promise<Pool | undefined> {
  const databaseUrl = databaseUrlFromProfile()
  if (databaseUrl === undefined) {
    t.skip('the local database url is not configured')
    return undefined
  }
  const pool = new Pool({ connectionString: databaseUrl })
  await pool.query(readFileSync(new URL('../../database/migrations/0007_storage.sql', import.meta.url), 'utf8'))
  t.after(async () => {
    await pool.query('delete from console_storage_record where unit_name = $1', [name])
    await pool.query('delete from console_storage_global where unit_name = $1', [name])
    await pool.query('delete from console_storage_unit where name = $1', [name])
    await pool.end()
  })
  return pool
}

function databaseUrlFromProfile(): string | undefined {
  try {
    const text = readFileSync(new URL('../../../tmp/dsh-home/profiles/web/cordis.patch.yml', import.meta.url), 'utf8')
    return text.match(/databaseUrl:\s*(\S+)/)?.[1]?.replace(/,+$/, '')
  } catch {
    return undefined
  }
}
