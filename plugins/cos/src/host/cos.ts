import COS from 'cos-nodejs-sdk-v5'
import type { BucketSettings } from './config.ts'

export interface CosClient {
  getBucket(params: Record<string, unknown>, callback: (error: unknown, data: any) => void): void
  putObject(params: Record<string, unknown>, callback: (error: unknown, data: any) => void): void
  putObjectCopy(params: Record<string, unknown>, callback: (error: unknown, data: any) => void): void
  getObject(params: Record<string, unknown>, callback: (error: unknown, data: any) => void): void
  headObject(params: Record<string, unknown>, callback: (error: unknown, data: any) => void): void
  deleteObject(params: Record<string, unknown>, callback: (error: unknown, data: any) => void): void
  getObjectUrl(params: Record<string, unknown>, callback?: (error: unknown, data: any) => void): unknown
}

export type CosFactory = (secretId: string, secretKey: string) => CosClient

export class CosRequestError extends Error {
  readonly statusCode: number | undefined
  readonly code: string | undefined
  readonly requestId: string | undefined

  constructor(message: string, statusCode?: number, code?: string, requestId?: string) {
    super(message)
    this.name = 'CosRequestError'
    this.statusCode = statusCode
    this.code = code
    this.requestId = requestId
  }
}

export const defaultFactory: CosFactory = (secretId, secretKey) => new COS({ SecretId: secretId, SecretKey: secretKey }) as unknown as CosClient

export function createClient(settings: BucketSettings, factory: CosFactory = defaultFactory): CosClient {
  return factory(settings.secretId, settings.secretKey)
}

export function invoke(client: CosClient, method: keyof CosClient, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const fn = client[method] as (params: Record<string, unknown>, cb: (error: unknown, data: any) => void) => void
    fn.call(client, params, (error, data) => (error ? reject(error) : resolve(data)))
  })
}

export function toRequestError(cause: any): CosRequestError {
  const legacy = cause?.error
  const code = cause?.code ?? (typeof legacy === 'object' ? legacy?.Code : undefined)
  const message = cause?.message ?? (typeof legacy === 'object' ? legacy?.Message : undefined) ?? 'COS 请求失败'
  return new CosRequestError(String(message), cause?.statusCode, code === undefined ? undefined : String(code), cause?.RequestId)
}

export interface MappedError {
  code: string
  detail: string
}

export function mapError(cause: unknown): MappedError {
  const error = cause instanceof CosRequestError ? cause : toRequestError(cause)
  const code = error.code ?? ''
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') return { code: 'credentials_invalid', detail: error.message }
  if (code === 'NoSuchBucket' || code === 'BucketNotFound') return { code: 'cos_bucket_not_found', detail: error.message }
  if (code === 'RequestTimeTooSkewed') return { code: 'cos_clock_skew', detail: error.message }
  if (error.statusCode === 404 || code === 'NoSuchKey') return { code: 'object_not_found', detail: error.message }
  if (error.statusCode === 403 || code === 'AccessDenied' || code === 'Forbidden') return { code: 'cos_forbidden', detail: error.message }
  return { code: 'cos_error', detail: error.requestId === undefined ? error.message : `${error.message} (${error.requestId})` }
}

/** Object key relative to a bucket prefix; rejects empty, traversal and oversized keys. */
export function sanitizeKey(input: string, basePrefix: string): string {
  const value = input.trim().replace(/\\/g, '/')
  if (value === '') throw new Error('key 不能为空')
  if (value.startsWith('/')) throw new Error('key 不能以 / 开头')
  if (value.split('/').includes('..')) throw new Error('key 不能包含 ..')
  if (value.length > 1024) throw new Error('key 过长')
  return `${basePrefix}${value}`
}

export function attachmentKey(prefix: string, kind: 'objects' | 'file-objects', sha: string): string {
  return `${prefix}${kind}/${sha.slice(0, 2)}/${sha}`
}

export function attachmentFileKey(prefix: string, sha: string, name: string): string {
  return `${prefix}v1/files/${sha.slice(0, 2)}/${sha}/${encodeURIComponent(name)}`
}
