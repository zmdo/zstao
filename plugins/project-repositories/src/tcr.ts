import { createHash, createHmac } from 'node:crypto'
import { ApiError } from './onedev.ts'

export interface TcrSettings {
  registry: string
  namespace: string
  region: string
  secretId: string
  secretKey: string
}

export interface TcrRepository {
  name: string
  tagCount: number
  public: boolean
  pullCount: number
  creationTime: string
  updateTime: string
  description: string
}

export interface TcrTag {
  name: string
  digest: string
  size: number
  created: string
  updated: string
  pushed: string
  os: string
  architecture: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function signedRequest(settings: TcrSettings, action: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  const host = 'tcr.tencentcloudapi.com'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload)
  const contentType = 'application/json; charset=utf-8'
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n')
  const scope = `${date}/tcr/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, sha256(canonicalRequest)].join('\n')
  const secretDate = hmac(`TC3${settings.secretKey}`, date)
  const secretService = hmac(secretDate, 'tcr')
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${settings.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': contentType,
      host,
      'x-tc-action': action,
      'x-tc-version': '2019-09-24',
      'x-tc-region': settings.region,
      'x-tc-timestamp': String(timestamp),
    },
    body,
    signal,
    redirect: 'error',
  })
}

async function request(settings: TcrSettings, action: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await signedRequest(settings, action, payload, AbortSignal.any([signal, AbortSignal.timeout(12_000)]))
  } catch (cause) {
    throw new ApiError(502, 'tcr_unavailable', { cause })
  }
  let data: unknown
  try {
    data = await response.json()
  } catch (cause) {
    throw new ApiError(502, 'tcr_invalid_response', { cause })
  }
  if (!response.ok || typeof data !== 'object' || data === null || Array.isArray(data)) throw new ApiError(502, 'tcr_request_failed')
  const body = data as Record<string, unknown>
  const responseBody = body.Response
  if (typeof responseBody !== 'object' || responseBody === null || Array.isArray(responseBody)) throw new ApiError(502, 'tcr_invalid_response')
  const result = responseBody as Record<string, unknown>
  if (result.Error !== undefined) {
    const error = result.Error as Record<string, unknown>
    throw new ApiError(502, typeof error.Code === 'string' ? `tcr_${error.Code}` : 'tcr_request_failed')
  }
  return result
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export async function tcrRepositories(settings: TcrSettings, offset: number, limit: number, signal: AbortSignal, repoName = ''): Promise<{ repositories: TcrRepository[]; total: number; server: string }> {
  const payload: Record<string, unknown> = { Namespace: settings.namespace, Offset: offset, Limit: limit }
  if (repoName !== '') payload.RepoName = repoName
  const result = await request(settings, 'DescribeRepositoryFilterPersonal', payload, signal)
  const data = result.Data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ApiError(502, 'tcr_invalid_response')
  const row = data as Record<string, unknown>
  const list = Array.isArray(row.RepoInfo) ? row.RepoInfo : []
  const repositories = list.map(value => {
    const repo = value as Record<string, unknown>
    return {
      name: text(repo.RepoName),
      tagCount: typeof repo.TagCount === 'number' ? repo.TagCount : 0,
      public: repo.Public === 1,
      pullCount: typeof repo.PullCount === 'number' ? repo.PullCount : 0,
      creationTime: text(repo.CreationTime),
      updateTime: text(repo.UpdateTime),
      description: text(repo.Description),
    }
  })
  return { repositories, total: typeof row.TotalCount === 'number' ? row.TotalCount : repositories.length, server: text(row.Server) || settings.registry }
}

export async function tcrDeleteTag(settings: TcrSettings, repository: string, tag: string, signal: AbortSignal): Promise<void> {
  await request(settings, 'DeleteImagePersonal', { RepoName: repository, Tag: tag }, signal)
}

async function privateRepository(settings: TcrSettings, repository: string, signal: AbortSignal): Promise<boolean> {
  let result: Record<string, unknown>
  try { result = await request(settings, 'DescribeRepositoryPersonal', { RepoName: repository }, signal) }
  catch (cause) {
    if (cause instanceof ApiError && cause.code === 'tcr_ResourceNotFound.ErrNoRepo') return false
    throw cause
  }
  const data = result.Data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(502, 'tcr_invalid_response')
  const row = data as Record<string, unknown>
  if (row.RepoName !== repository) throw new ApiError(502, 'tcr_repository_mismatch')
  if (row.Public !== 0) throw new ApiError(409, 'delivery_repository_must_be_private')
  return true
}

export async function ensurePrivateRepository(settings: TcrSettings, projectId: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(settings.namespace)) throw new ApiError(400, 'invalid_delivery_repository')
  const repository = `${settings.namespace}/ces-project-${projectId}`
  if (await privateRepository(settings, repository, signal)) return { repository, created: false }
  let recovered = false
  try { await request(settings, 'CreateRepositoryPersonal', { RepoName: repository, Public: 0, Description: `CES OneDev project ${projectId}` }, signal) }
  catch (cause) {
    // Reconcile lost responses and concurrent creation without submitting twice.
    if (!await privateRepository(settings, repository, signal)) throw cause
    recovered = true
  }
  if (!await privateRepository(settings, repository, signal)) throw new ApiError(502, 'repository_creation_unconfirmed_retry_prepare_delivery')
  return { repository, created: !recovered }
}

export async function tcrTags(settings: TcrSettings, repository: string, offset: number, limit: number, signal: AbortSignal): Promise<{ tags: TcrTag[]; total: number }> {
  const result = await request(settings, 'DescribeImagePersonal', { RepoName: repository, Offset: offset, Limit: limit }, signal)
  const data = result.Data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ApiError(502, 'tcr_invalid_response')
  const row = data as Record<string, unknown>
  const list = Array.isArray(row.TagInfo) ? row.TagInfo : []
  const tags = list.map(value => {
    const tag = value as Record<string, unknown>
    return {
      name: text(tag.TagName),
      digest: text(tag.TagId),
      size: typeof tag.SizeByte === 'number' ? tag.SizeByte : 0,
      created: text(tag.CreationTime),
      updated: text(tag.UpdateTime),
      pushed: text(tag.PushTime),
      os: text(tag.OS),
      architecture: text(tag.Architecture),
    }
  })
  return { tags, total: typeof row.TagCount === 'number' ? row.TagCount : tags.length }
}

export async function tcrTag(settings: TcrSettings, repository: string, name: string, signal: AbortSignal): Promise<TcrTag> {
  for (let offset = 0; offset < 10_000; offset += 100) {
    signal.throwIfAborted()
    const result = await tcrTags(settings, repository, offset, 100, signal)
    const tag = result.tags.find(tag => tag.name === name)
    if (tag) return tag
    if (offset + result.tags.length >= result.total) throw new ApiError(404, 'tag_not_found')
    if (result.tags.length === 0) throw new ApiError(502, 'tag_lookup_incomplete')
  }
  throw new ApiError(422, 'tag_lookup_incomplete')
}
