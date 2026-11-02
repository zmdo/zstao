export interface Queryable {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>
}

export interface DomainRow {
  id: string
  name: string
  zone_id: string
  account_id: string
  account_name: string
  status: string
  created_at: string
  token_ciphertext: string
}

export interface ManagedDomain {
  id: string
  name: string
  zoneId: string
  accountId: string
  accountName: string
  status: string
  createdAt: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function publicDomain(row: DomainRow): ManagedDomain {
  return {
    id: row.id,
    name: row.name,
    zoneId: row.zone_id,
    accountId: row.account_id,
    accountName: row.account_name,
    status: row.status,
    createdAt: row.created_at,
  }
}

export async function loadDomains(pool: Queryable): Promise<ManagedDomain[]> {
  const { rows } = await pool.query<DomainRow>(
    'select id, name, zone_id, account_id, account_name, status, created_at, token_ciphertext from domain_manager_domains order by created_at asc, name asc',
  )
  return rows.map(publicDomain)
}

/** Resolve a managed domain by id or exact name; anything else is never addressed. */
export async function resolveDomain(pool: Queryable, reference: string): Promise<DomainRow | undefined> {
  const value = reference.trim()
  if (value === '') return undefined
  const { rows } = value !== '' && UUID.test(value)
    ? await pool.query<DomainRow>('select * from domain_manager_domains where id = $1', [value])
    : await pool.query<DomainRow>('select * from domain_manager_domains where lower(name) = lower($1)', [value])
  return rows[0]
}

export async function findDomainByName(pool: Queryable, name: string): Promise<DomainRow | undefined> {
  const { rows } = await pool.query<DomainRow>('select * from domain_manager_domains where name = $1', [name])
  return rows[0]
}
