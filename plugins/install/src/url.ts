export interface DatabaseParts {
  host: string
  port: string
  database: string
  username: string
  password: string
}

/** Accept the psycopg URL used by the existing database setting. */
export function normalizeDatabaseUrl(value: string): string {
  const normalized = value.trim().replace(/^postgresql\+psycopg:/, 'postgresql:')
  if (!/^postgres(ql)?:\/\//.test(normalized)) {
    throw new Error('databaseUrl 必须是 PostgreSQL 地址')
  }
  return normalized
}

/** Build the store plugin's connection string from the install form. */
export function composeDatabaseUrl(parts: DatabaseParts): { ok: true, url: string } | { ok: false, detail: string } {
  const host = parts.host.trim()
  const portText = parts.port.trim()
  const database = parts.database.trim()
  const username = parts.username.trim()
  if (host === '' || /[\s/@:?#\\]/.test(host)) return { ok: false, detail: '地址格式不对' }
  if (!/^\d+$/.test(portText)) return { ok: false, detail: '端口必须是 1 到 65535' }
  const port = Number(portText)
  if (port < 1 || port > 65535) return { ok: false, detail: '端口必须是 1 到 65535' }
  if (database === '' || /[\s/?#]/.test(database)) return { ok: false, detail: '数据库名称不对' }
  if (username === '') return { ok: false, detail: '用户名不能为空' }
  if (parts.password === '') return { ok: false, detail: '密码不能为空' }
  const url = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(parts.password)}@${host}:${port}/${encodeURIComponent(database)}`
  return { ok: true, url }
}
