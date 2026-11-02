import { StorageError, UNIT_NAME_RE } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import type { Pool, PoolClient } from 'pg'
import { readUnitFile } from './import.ts'

/**
 * KV backend over the console database. Workspace is the unit routed here;
 * the same tables can hold another unit if a later route names `postgres`.
 */
export class PostgresStorageBackend implements StorageBackend {
  private readonly openUnits = new Map<string, PostgresUnit>()
  private readonly pool: Pool
  private readonly importRoot: string
  private closed = false

  constructor(pool: Pool, importRoot: string) {
    this.pool = pool
    this.importRoot = importRoot
  }

  readonly kv = {
    open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      if (this.closed) throw new StorageError('closed', 'postgres backend is closed')
      validateDescriptor(descriptor)
      if (this.openUnits.has(descriptor.name)) {
        throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`)
      }
      const version = await this.storedVersion(descriptor.name)
      if (version !== undefined && version !== descriptor.version) {
        throw new StorageError('version-mismatch', `unit '${descriptor.name}': stored version ${version} != expected ${descriptor.version}`)
      }
      if (version === undefined) await this.importIfPresent(descriptor)
      const unit = new PostgresUnit(this.pool, descriptor, () => {
        this.openUnits.delete(descriptor.name)
      })
      this.openUnits.set(descriptor.name, unit)
      return unit
    },
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const unit of [...this.openUnits.values()]) await unit.close()
  }

  private async storedVersion(name: string): Promise<number | undefined> {
    const result = await this.pool.query<{ version: number }>(
      'select version from console_storage_unit where name = $1',
      [name],
    )
    return result.rows[0]?.version
  }

  private async importIfPresent(descriptor: KvUnitDescriptor): Promise<void> {
    const imported = await readUnitFile(this.importRoot, descriptor)
    if (imported === undefined) return
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const inserted = await client.query(
        `insert into console_storage_unit (name, version) values ($1, $2)
         on conflict (name) do nothing
         returning name`,
        [descriptor.name, imported.version],
      )
      if ((inserted.rowCount ?? 0) === 0) {
        await client.query('commit')
        return
      }
      if (imported.global !== null) {
        await client.query(
          `insert into console_storage_global (unit_name, value) values ($1, $2::jsonb)`,
          [descriptor.name, JSON.stringify(imported.global)],
        )
      }
      for (const [table, records] of Object.entries(imported.tables)) {
        for (const [key, value] of Object.entries(records)) {
          await client.query(
            `insert into console_storage_record (unit_name, table_name, record_key, value)
             values ($1, $2, $3, $4::jsonb)`,
            [descriptor.name, table, key, JSON.stringify(value)],
          )
        }
      }
      await client.query('commit')
    } catch (cause) {
      await rollback(client)
      throw cause
    } finally {
      client.release()
    }
  }
}

class PostgresUnit implements KvUnit {
  private closed = false
  private readonly pending = new Set<Promise<unknown>>()
  private readonly pool: Pool
  private readonly descriptor: KvUnitDescriptor
  private readonly onClose: () => void

  constructor(pool: Pool, descriptor: KvUnitDescriptor, onClose: () => void) {
    this.pool = pool
    this.descriptor = descriptor
    this.onClose = onClose
  }

  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>, global: unknown }> {
    return this.track(this.readAll())
  }

  putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertTable(table)
    return this.track(this.writeRecord(table, key, value))
  }

  deleteRecord(table: string, key: string): Promise<void> {
    this.assertTable(table)
    return this.track(this.removeRecord(table, key))
  }

  setGlobal(value: unknown): Promise<void> {
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    return this.track(this.writeGlobal(value))
  }

  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.pending)
      return
    }
    this.closed = true
    await Promise.allSettled(this.pending)
    this.onClose()
  }

  private async readAll(): Promise<{ tables: Record<string, Record<string, unknown>>, global: unknown }> {
    this.assertOpen()
    const records = await this.pool.query<{ table_name: string, record_key: string, value: unknown }>(
      `select table_name, record_key, value from console_storage_record where unit_name = $1`,
      [this.descriptor.name],
    )
    const tables: Record<string, Record<string, unknown>> = {}
    for (const table of this.descriptor.tables) tables[table] = {}
    for (const row of records.rows) {
      const table = tables[row.table_name]
      if (table === undefined) continue
      table[row.record_key] = row.value
    }
    const global = await this.pool.query<{ value: unknown }>(
      'select value from console_storage_global where unit_name = $1',
      [this.descriptor.name],
    )
    return { tables, global: global.rows[0]?.value ?? null }
  }

  private async writeRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    await this.transaction(async (client) => {
      await ensureUnit(client, this.descriptor)
      await client.query(
        `insert into console_storage_record (unit_name, table_name, record_key, value)
         values ($1, $2, $3, $4::jsonb)
         on conflict (unit_name, table_name, record_key) do update set value = excluded.value`,
        [this.descriptor.name, table, key, JSON.stringify(value)],
      )
    })
  }

  private async removeRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    await this.pool.query(
      `delete from console_storage_record
       where unit_name = $1 and table_name = $2 and record_key = $3`,
      [this.descriptor.name, table, key],
    )
  }

  private async writeGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    await this.transaction(async (client) => {
      await ensureUnit(client, this.descriptor)
      if (value === null) {
        await client.query('delete from console_storage_global where unit_name = $1', [this.descriptor.name])
        return
      }
      await client.query(
        `insert into console_storage_global (unit_name, value) values ($1, $2::jsonb)
         on conflict (unit_name) do update set value = excluded.value`,
        [this.descriptor.name, JSON.stringify(value)],
      )
    })
  }

  private async transaction(body: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await body(client)
      await client.query('commit')
    } catch (cause) {
      await rollback(client)
      throw cause
    } finally {
      client.release()
    }
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work)
    work.then(() => undefined, () => undefined).finally(() => this.pending.delete(work))
    return work
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
  }

  private assertTable(table: string): void {
    this.assertOpen()
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
  }
}

async function ensureUnit(client: PoolClient, descriptor: KvUnitDescriptor): Promise<void> {
  await client.query(
    `insert into console_storage_unit (name, version) values ($1, $2)
     on conflict (name) do nothing`,
    [descriptor.name, descriptor.version],
  )
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback')
  } catch (error) {
    void error
  }
}

function validateDescriptor(descriptor: KvUnitDescriptor): void {
  if (!UNIT_NAME_RE.test(descriptor.name)) {
    throw new StorageError('malformed-medium', `invalid unit name '${descriptor.name}'`)
  }
  for (const table of descriptor.tables) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new StorageError('malformed-medium', `invalid table name '${table}' in unit '${descriptor.name}'`)
    }
  }
}
