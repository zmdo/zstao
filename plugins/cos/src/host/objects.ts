import { invoke, sanitizeKey, toRequestError, type CosClient } from './cos.ts'
import type { BucketSettings } from './config.ts'

export interface ObjectItem {
  kind: 'folder' | 'file'
  key: string
  name: string
  size: number | null
  lastModified: string | null
}

export interface ObjectPage {
  items: ObjectItem[]
  nextMarker: string
  truncated: boolean
}

function decode(value: unknown): string {
  const text = String(value ?? '')
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function leafName(key: string, prefix: string): string {
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key
  return rest.replace(/\/$/, '').split('/').pop() ?? rest
}

export async function listObjects(
  settings: BucketSettings,
  client: CosClient,
  options: { prefix: string; marker: string; limit: number; search: string },
): Promise<ObjectPage> {
  const prefix = `${settings.basePrefix}${options.prefix.replace(/^\/+/, '')}`
  const limit = Math.min(Math.max(options.limit, 1), 1000)
  const search = options.search.trim().toLowerCase()

  if (search === '') {
    const data = await invoke(client, 'getBucket', {
      Bucket: settings.bucket,
      Region: settings.region,
      Prefix: prefix,
      Delimiter: '/',
      Marker: options.marker,
      MaxKeys: limit,
      EncodingType: 'url',
    })
    const folders: ObjectItem[] = (data.CommonPrefixes ?? []).map((entry: { Prefix?: string }) => {
      const key = decode(entry.Prefix)
      return { kind: 'folder' as const, key, name: leafName(key, prefix), size: null, lastModified: null }
    })
    const files: ObjectItem[] = (data.Contents ?? [])
      .filter((entry: { Key?: string }) => entry.Key !== undefined && !String(entry.Key).endsWith('/'))
      .map((entry: { Key?: string; Size?: string; LastModified?: string }) => {
        const key = decode(entry.Key)
        return {
          kind: 'file' as const,
          key,
          name: leafName(key, prefix),
          size: Number(entry.Size ?? 0),
          lastModified: entry.LastModified ?? null,
        }
      })
    return { items: [...folders, ...files], nextMarker: data.NextMarker ?? '', truncated: String(data.IsTruncated) === 'true' }
  }

  let marker = ''
  let scanned = 0
  const matches: ObjectItem[] = []
  let truncated = false
  for (let page = 0; page < 5; page += 1) {
    const data = await invoke(client, 'getBucket', {
      Bucket: settings.bucket,
      Region: settings.region,
      Prefix: prefix,
      Marker: marker,
      MaxKeys: 1000,
      EncodingType: 'url',
    })
    for (const entry of data.Contents ?? []) {
      const key = decode(entry.Key)
      if (String(entry.Key).endsWith('/')) continue
      scanned += 1
      const name = leafName(key, prefix)
      if (name.toLowerCase().includes(search)) {
        matches.push({ kind: 'file', key, name, size: Number(entry.Size ?? 0), lastModified: entry.LastModified ?? null })
        if (matches.length >= limit) break
      }
    }
    if (matches.length >= limit) {
      truncated = true
      break
    }
    if (String(data.IsTruncated) !== 'true' || data.NextMarker === undefined) break
    marker = String(data.NextMarker)
    if (page === 4) truncated = true
  }
  return { items: matches, nextMarker: '', truncated }
}

export async function putObject(
  settings: BucketSettings,
  client: CosClient,
  relativeKey: string,
  body: NodeJS.ReadableStream,
  contentLength: number,
  contentType: string,
): Promise<void> {
  const key = sanitizeKey(relativeKey, settings.basePrefix)
  await invoke(client, 'putObject', {
    Bucket: settings.bucket,
    Region: settings.region,
    Key: key,
    Body: body,
    ContentLength: contentLength,
    ContentType: contentType,
  })
}

export async function deleteObject(settings: BucketSettings, client: CosClient, relativeKey: string): Promise<void> {
  const key = sanitizeKey(relativeKey, settings.basePrefix)
  await invoke(client, 'deleteObject', { Bucket: settings.bucket, Region: settings.region, Key: key })
}

/** COS has no server-side move/rename: a move is copy + delete. */
export async function copyObject(settings: BucketSettings, client: CosClient, sourceKey: string, destKey: string): Promise<void> {
  const source = sanitizeKey(sourceKey, settings.basePrefix)
  const dest = sanitizeKey(destKey, settings.basePrefix)
  const copySource = `${settings.bucket}.cos.${settings.region}.myqcloud.com/${source.split('/').map(encodeURIComponent).join('/')}`
  await invoke(client, 'putObjectCopy', {
    Bucket: settings.bucket,
    Region: settings.region,
    Key: dest,
    CopySource: copySource,
  })
}

export interface PrefixEntry {
  key: string
  size: number
}

/** List objects under a prefix without folder grouping, capped at `limit`. */
export async function listPrefixEntries(
  settings: BucketSettings,
  client: CosClient,
  prefix: string,
  limit: number,
): Promise<{ items: PrefixEntry[]; truncated: boolean }> {
  const actual = `${settings.basePrefix}${prefix}`
  const items: PrefixEntry[] = []
  let marker = ''
  for (let page = 0; page < 1000; page += 1) {
    const data = await invoke(client, 'getBucket', {
      Bucket: settings.bucket,
      Region: settings.region,
      Prefix: actual,
      Marker: marker,
      MaxKeys: 1000,
      EncodingType: 'url',
    })
    for (const entry of data.Contents ?? []) {
      const key = decode(entry.Key)
      if (key.endsWith('/')) continue
      if (!key.startsWith(actual)) continue
      if (items.length >= limit) return { items, truncated: true }
      items.push({ key: key.slice(settings.basePrefix.length), size: Number(entry.Size ?? 0) })
    }
    if (String(data.IsTruncated) !== 'true') return { items, truncated: false }
    const next = String(data.NextMarker ?? '')
    if (next === '' || next === marker) return { items, truncated: false }
    marker = next
  }
  return { items, truncated: true }
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.zip': 'application/zip', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[path.toLowerCase().slice(path.lastIndexOf('.'))] ?? 'application/octet-stream'
}

export function signedDownloadUrl(settings: BucketSettings, client: CosClient, relativeKey: string, name: string): Promise<string> {
  const key = sanitizeKey(relativeKey, settings.basePrefix)
  return new Promise((resolve, reject) => {
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
    ;(client.getObjectUrl as any)(
      {
        Bucket: settings.bucket,
        Region: settings.region,
        Key: key,
        Sign: true,
        Expires: 300,
        Protocol: 'https:',
        Query: { 'response-content-disposition': disposition },
      },
      (error: unknown, data: { Url?: string }) => (error ? reject(toRequestError(error)) : resolve(String(data?.Url ?? ''))),
    )
  })
}

export async function statObject(settings: BucketSettings, client: CosClient, relativeKey: string): Promise<{ size: number; etag: string }> {
  const key = sanitizeKey(relativeKey, settings.basePrefix)
  const data = await invoke(client, 'headObject', { Bucket: settings.bucket, Region: settings.region, Key: key })
  return { size: Number(data.headers?.['content-length'] ?? 0), etag: String(data.headers?.etag ?? data.ETag ?? '') }
}

export function signedInlineUrl(settings: BucketSettings, client: CosClient, relativeKey: string, name: string): Promise<string> {
  const key = sanitizeKey(relativeKey, settings.basePrefix)
  return new Promise((resolve, reject) => {
    const disposition = `inline; filename*=UTF-8''${encodeURIComponent(name)}`
    ;(client.getObjectUrl as any)(
      {
        Bucket: settings.bucket,
        Region: settings.region,
        Key: key,
        Sign: true,
        Expires: 300,
        Protocol: 'https:',
        Query: { 'response-content-disposition': disposition },
      },
      (error: unknown, data: { Url?: string }) => (error ? reject(toRequestError(error)) : resolve(String(data?.Url ?? ''))),
    )
  })
}

export async function readObjectText(
  settings: BucketSettings,
  client: CosClient,
  relativeKey: string,
  maxBytes: number,
): Promise<{ size: number; text: string }> {
  const stat = await statObject(settings, client, relativeKey)
  if (stat.size > maxBytes) throw new Error(`文件超过预览上限 ${Math.floor(maxBytes / 1024)}KB`)
  const key = sanitizeKey(relativeKey, settings.basePrefix)
  const data = await invoke(client, 'getObject', { Bucket: settings.bucket, Region: settings.region, Key: key })
  const body = Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body)
  return { size: stat.size, text: body.toString('utf8') }
}
