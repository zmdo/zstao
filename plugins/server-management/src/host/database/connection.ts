export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  connect(): Promise<DbClient>
}

export interface DbClient extends Db {
  release(): void
}
