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
