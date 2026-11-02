/** Accept the psycopg URL used by the existing database setting. */
export function normalizeDatabaseUrl(value: string): string {
  const normalized = value.trim().replace(/^postgresql\+psycopg:/, 'postgresql:')
  if (!/^postgres(ql)?:\/\//.test(normalized)) {
    throw new Error('databaseUrl 必须是 PostgreSQL 地址')
  }
  return normalized
}
