export type Role = 'attachments' | 'default'

export interface Queryable {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>
}

export interface Secrets {
  encrypt(plaintext: string): string
  decrypt(token: string): string
}

export interface BucketSettings {
  role: Role
  bucket: string
  region: string
  secretId: string
  secretKey: string
  basePrefix: string
  maxUploadBytes: number
  maxPreviewBytes: number
  enabled: boolean
}

export interface BucketInput {
  bucket?: string
  region?: string
  secretId?: string
  secretKey?: string
  basePrefix?: string
  maxUploadBytes?: number
  maxPreviewBytes?: number
  enabled?: boolean
}

interface BucketRow {
  role: Role
  bucket: string
  region: string
  secret_id: string
  secret_key_ciphertext: string
  base_prefix: string
  max_upload_bytes: string | number
  max_preview_bytes: string | number
  enabled: boolean
}

export const ROLES: readonly Role[] = ['attachments', 'default']

export function isRole(value: unknown): value is Role {
  return value === 'attachments' || value === 'default'
}

/** Prefix normalisation: trim, strip leading slashes, keep one trailing slash. */
export function normalizePrefix(value: string | undefined): string {
  const text = (value ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return text === '' ? '' : `${text}/`
}

export function bucketRowToSettings(row: BucketRow, secrets: Secrets): BucketSettings {
  return {
    role: row.role,
    bucket: row.bucket,
    region: row.region,
    secretId: row.secret_id,
    secretKey: secrets.decrypt(row.secret_key_ciphertext),
    basePrefix: row.base_prefix,
    maxUploadBytes: Number(row.max_upload_bytes),
    maxPreviewBytes: Number(row.max_preview_bytes),
    enabled: row.enabled,
  }
}

export async function loadBucket(pool: Queryable, secrets: Secrets, role: Role): Promise<BucketSettings | undefined> {
  const { rows } = await pool.query<BucketRow>('select * from cos_buckets where role = $1', [role])
  const row = rows[0]
  return row === undefined ? undefined : bucketRowToSettings(row, secrets)
}

export async function loadBuckets(pool: Queryable, secrets: Secrets): Promise<Record<Role, BucketSettings | undefined>> {
  const { rows } = await pool.query<BucketRow>('select * from cos_buckets')
  const result: Record<Role, BucketSettings | undefined> = { attachments: undefined, default: undefined }
  for (const row of rows) result[row.role] = bucketRowToSettings(row, secrets)
  return result
}

export function validateInput(role: Role, input: BucketInput): string | undefined {
  if ((input.bucket ?? '').trim() === '') return 'bucket 不能为空'
  if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test((input.bucket ?? '').trim())) return 'bucket 格式应为 name-appid'
  if ((input.region ?? '').trim() === '') return 'region 不能为空'
  if (role === 'default' && input.maxUploadBytes !== undefined) {
    const max = Number(input.maxUploadBytes)
    if (!Number.isFinite(max) || max < 1_048_576 || max > 2_147_483_648) return '上传上限需在 1MB 到 2048MB 之间'
  }
  if (role === 'default' && input.maxPreviewBytes !== undefined) {
    const preview = Number(input.maxPreviewBytes)
    if (!Number.isFinite(preview) || preview < 1_048_576 || preview > 209_715_200) return '预览上限需在 1MB 到 200MB 之间'
  }
  const prefix = normalizePrefix(input.basePrefix)
  if (prefix.length > 512) return 'basePrefix 过长'
  return undefined
}

export async function saveBucket(pool: Queryable, secrets: Secrets, role: Role, input: BucketInput): Promise<BucketSettings> {
  const bucket = (input.bucket ?? '').trim()
  const region = (input.region ?? '').trim()
  const existing = await loadBucket(pool, secrets, role)
  const secretId = (input.secretId ?? '').trim() === '' ? existing?.secretId : input.secretId?.trim()
  if (secretId === undefined || secretId === '') throw new Error('SecretId 不能为空')
  const secretKey = (input.secretKey ?? '').trim() === '' ? existing?.secretKey : input.secretKey?.trim()
  if (secretKey === undefined || secretKey === '') throw new Error('SecretKey 不能为空')
  const ciphertext = secrets.encrypt(secretKey)
  const prefix = normalizePrefix(input.basePrefix)
  const maxUploadBytes = role === 'default' ? Math.floor(Number(input.maxUploadBytes ?? 104_857_600)) : 104_857_600
  const maxPreviewBytes = role === 'default' ? Math.floor(Number(input.maxPreviewBytes ?? 20_971_520)) : 20_971_520
  const enabled = input.enabled !== false
  await pool.query(
    `insert into cos_buckets (role, bucket, region, secret_id, secret_key_ciphertext, base_prefix, max_upload_bytes, max_preview_bytes, enabled, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (role) do update set
       bucket = excluded.bucket,
       region = excluded.region,
       secret_id = excluded.secret_id,
       secret_key_ciphertext = excluded.secret_key_ciphertext,
       base_prefix = excluded.base_prefix,
       max_upload_bytes = excluded.max_upload_bytes,
       max_preview_bytes = excluded.max_preview_bytes,
       enabled = excluded.enabled,
       updated_at = now()`,
    [role, bucket, region, secretId, ciphertext, prefix, maxUploadBytes, maxPreviewBytes, enabled],
  )
  return { role, bucket, region, secretId, secretKey, basePrefix: prefix, maxUploadBytes, maxPreviewBytes, enabled }
}

export async function clearBuckets(pool: Queryable): Promise<void> {
  await pool.query('delete from cos_buckets')
}
