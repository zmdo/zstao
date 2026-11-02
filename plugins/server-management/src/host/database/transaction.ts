import type { Db, DbClient } from './connection.ts'

const SCOPE = Symbol('transaction scope')
type ScopedClient = DbClient & { [SCOPE]: true }

export async function transaction<T>(db: Db, run: (client: DbClient) => Promise<T>): Promise<T> {
  return inTransaction(db, 'begin', run)
}

export async function readTransaction<T>(db: Db, run: (client: DbClient) => Promise<T>): Promise<T> {
  return inTransaction(db, 'begin isolation level repeatable read read only', run)
}

async function inTransaction<T>(db: Db, begin: string, run: (client: DbClient) => Promise<T>): Promise<T> {
  if (SCOPE in db) return run(db as ScopedClient)
  const client = await db.connect()
  const scope: ScopedClient = {
    [SCOPE]: true,
    query: client.query.bind(client),
    connect: async () => scope,
    release() {},
  }
  try {
    await client.query(begin)
    const result = await run(scope)
    await client.query('commit')
    return result
  } catch (cause) {
    await client.query('rollback')
    throw cause
  } finally {
    client.release()
  }
}

export function isUnique(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === '23505'
}

/** Roll back a failed nested binding without losing the task’s known remote result. */
export async function savepoint<T>(db: Db, name: 'binding_commit', run: () => Promise<T>): Promise<T> {
  await db.query(`savepoint ${name}`)
  try {
    const value = await run()
    await db.query(`release savepoint ${name}`)
    return value
  } catch (cause) {
    await db.query(`rollback to savepoint ${name}`)
    await db.query(`release savepoint ${name}`)
    throw cause
  }
}
