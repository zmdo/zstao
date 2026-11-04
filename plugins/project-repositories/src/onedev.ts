import { COMMIT_LIMIT, DIRECTORY_LIMIT, DOWNLOAD_BYTES, PREVIEW_BYTES, PREVIEW_LINES } from './shared.ts'
import type { CommitList, FilePreview, Project, RefType, Repository, Tree } from './shared.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, options?: ErrorOptions) {
    super(code, options)
    this.status = status
    this.code = code
  }
}
export interface ConnectionSettings {
  internalBaseUrl: string
  externalBaseUrl: string
  username: string
  passwordCiphertext: string
}
export interface Secrets { encrypt(value: string): string; decrypt(value: string): string }
export function decryptPassword(settings: ConnectionSettings, secrets: Secrets): string {
  if (settings.passwordCiphertext === '') throw new ApiError(409, 'not_configured')
  try { return secrets.decrypt(settings.passwordCiphertext) } catch (cause) { throw new ApiError(409, 'credentials_unavailable', { cause }) }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(502, 'invalid_upstream')
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(502, 'invalid_upstream')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ApiError(502, 'invalid_upstream')
  return value.map(string)
}
export function projectId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError(400, 'invalid_project')
  return Number(value)
}
export function commitSha(value: string): string {
  if (!/^[a-f0-9]{40}$/i.test(value)) throw new ApiError(400, 'invalid_revision')
  return value.toLowerCase()
}
export function repositoryPath(value: string, allowRoot = true): string {
  if (value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value) || value.startsWith('/') || value.split('/').some(part => part === '..' || part === '.' || (part === '' && value !== '')) || (!allowRoot && value === '')) {
    throw new ApiError(400, 'invalid_path')
  }
  return value
}
export function imageType(data: Buffer): string | undefined {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}
export interface BlobFile { path: string; bytes: Buffer; size: number; partial: boolean }
export function preview(file: BlobFile): FilePreview {
  const byteLimit = Math.min(file.bytes.length, PREVIEW_BYTES)
  let end = byteLimit
  if (end < file.bytes.length) while (end > 0 && (file.bytes[end] & 0xc0) === 0x80) end--
  const bytes = file.bytes.subarray(0, end)
  let content = ''
  let binary = bytes.includes(0) || imageType(bytes) !== undefined
  if (!binary) {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: file.partial || end < file.bytes.length }) } catch (cause) { void cause; binary = true }
  }
  const lines = content.split('\n')
  const truncated = file.partial || file.bytes.length > end || lines.length > PREVIEW_LINES
  content = lines.slice(0, PREVIEW_LINES).join('\n')
  return { path: file.path, size: file.size, content, binary, truncated, upstreamPartial: file.partial,
    highlight: !binary && !content.split('\n').some(line => line.length > 2000),
    downloadable: !file.partial && file.size <= DOWNLOAD_BYTES }
}

export class OneDev {
  private readonly authorization: string
  private readonly settings: ConnectionSettings
  private readonly signal: AbortSignal
  constructor(settings: ConnectionSettings, secrets: Secrets, signal: AbortSignal) {
    this.settings = settings
    this.signal = signal
    this.authorization = `Basic ${Buffer.from(`${settings.username}:${decryptPassword(settings, secrets)}`).toString('base64')}`
  }
  async request(path: string, params?: URLSearchParams, format: 'json' | 'text' = 'json'): Promise<unknown> {
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(12_000)])
    let response: Response
    try {
      response = await fetch(`${this.settings.internalBaseUrl}/~api/${path}${params ? `?${params}` : ''}`, {
        headers: { accept: 'application/json', authorization: this.authorization }, signal, redirect: 'error',
      })
    } catch (cause) { throw new ApiError(502, signal.aborted ? 'upstream_timeout' : 'upstream_unavailable', { cause }) }
    if (!response.ok) {
      await response.body?.cancel()
      const code = response.status === 401 ? 'upstream_credentials' : response.status === 403 ? 'upstream_forbidden' : response.status === 404 ? 'not_found' : response.status === 406 ? 'unsupported_entry' : 'upstream_error'
      throw new ApiError(response.status === 404 ? 404 : response.status === 406 ? 422 : 502, code)
    }
    if (response.status === 204) return null
    const max = 8 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > max) {
      await response.body?.cancel()
      throw new ApiError(413, 'response_too_large')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new ApiError(502, 'invalid_upstream')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > max) { await reader.cancel(); throw new ApiError(413, 'response_too_large') }
        chunks.push(value)
      }
    } catch (cause) {
      if (cause instanceof ApiError) throw cause
      throw new ApiError(502, signal.aborted ? 'upstream_timeout' : 'upstream_unavailable', { cause })
    } finally { reader.releaseLock() }
    const text = Buffer.concat(chunks).toString('utf8')
    if (format === 'text') return text
    try { return JSON.parse(text) } catch (cause) { throw new ApiError(502, 'invalid_upstream', { cause }) }
  }
  project(value: unknown): Project {
    const row = object(value)
    if (!Number.isSafeInteger(row.id) || Number(row.id) < 1) throw new ApiError(502, 'invalid_upstream')
    const path = string(row.path)
    return { id: Number(row.id), name: string(row.name), path, description: typeof row.description === 'string' ? row.description : '',
      codeManagement: row.codeManagement === true, issueManagement: row.issueManagement === true, packManagement: row.packManagement === true,
      webUrl: `${this.settings.externalBaseUrl}/${path.split('/').map(encodeURIComponent).join('/')}`,
      createDate: typeof row.createDate === 'string' ? row.createDate : '' }
  }
  async projects(offset: number): Promise<Project[]> {
    const data = await this.request('projects', new URLSearchParams({ offset: String(offset), count: '100' }))
    if (!Array.isArray(data)) throw new ApiError(502, 'invalid_upstream')
    return data.map(row => this.project(row))
  }
  async repository(id: number): Promise<Repository> {
    const project = this.project(await this.request(`projects/${id}`))
    if (!project.codeManagement) throw new ApiError(409, 'code_disabled')
    const [branches, tags, defaultBranch, clone] = await Promise.all([
      this.request(`repositories/${id}/branches`), this.request(`repositories/${id}/tags`),
      this.request(`repositories/${id}/default-branch`, undefined, 'text'), this.request(`projects/${id}/clone-url`),
    ])
    const rawClone = string(object(clone).http)
    let cloneUrl: URL
    try { cloneUrl = new URL(rawClone) } catch (cause) { throw new ApiError(502, 'invalid_upstream', { cause }) }
    if (!['http:', 'https:'].includes(cloneUrl.protocol)) throw new ApiError(502, 'invalid_upstream')
    // The browser's clone URL must use the configured public origin, never credentials.
    const external = new URL(this.settings.externalBaseUrl)
    const internal = new URL(this.settings.internalBaseUrl)
    const suffix = cloneUrl.pathname.startsWith(`${internal.pathname.replace(/\/$/, '')}/`) ? cloneUrl.pathname.slice(internal.pathname.replace(/\/$/, '').length) : cloneUrl.pathname
    cloneUrl = new URL(external.origin)
    cloneUrl.pathname = `${external.pathname.replace(/\/$/, '')}${suffix}`
    return { project, branches: strings(branches), tags: strings(tags), defaultBranch: defaultBranch === null ? null : string(defaultBranch), cloneUrl: cloneUrl.href }
  }
  async resolve(id: number, type: RefType, name: string): Promise<string> {
    if (!name || name.length > 1024 || /[\x00-\x1f\x7f]/.test(name)) throw new ApiError(400, 'invalid_revision')
    const row = object(await this.request(`repositories/${id}/${type === 'branch' ? 'branches' : 'tags'}/${encodeURIComponent(name)}`))
    return commitSha(string(row.commitHash))
  }
  async tree(id: number, sha: string, path: string): Promise<Tree> {
    const data = await this.request(`repositories/${id}/directories/${sha}${path ? '/' + path.split('/').map(encodeURIComponent).join('/') : ''}`)
    if (!Array.isArray(data)) throw new ApiError(502, 'invalid_upstream')
    const entries = data.slice(0, DIRECTORY_LIMIT).map(value => {
      const entry = object(value)
      const child = repositoryPath(string(entry.path), false)
      const relative = path === '' ? child : child.slice(path.length + 1)
      if ((path !== '' && !child.startsWith(`${path}/`)) || relative.includes('/') || relative === '' || typeof entry.isFile !== 'boolean') throw new ApiError(502, 'invalid_upstream')
      return { path: child, isFile: entry.isFile }
    }).sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.path.localeCompare(b.path))
    return { entries, truncated: data.length > DIRECTORY_LIMIT }
  }
  async file(id: number, sha: string, path: string): Promise<BlobFile> {
    const row = object(await this.request(`repositories/${id}/files`, new URLSearchParams({ revision: sha, file: path })))
    if (!Number.isSafeInteger(row.size) || Number(row.size) < 0 || typeof row.isPartial !== 'boolean') throw new ApiError(502, 'invalid_upstream')
    const base64 = string(row.base64Content)
    if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ApiError(502, 'invalid_upstream')
    const bytes = Buffer.from(base64, 'base64')
    const size = Number(row.size)
    if (bytes.length > size || (!row.isPartial && bytes.length !== size)) throw new ApiError(502, 'invalid_upstream')
    return { path, bytes, size, partial: row.isPartial }
  }
  async commits(id: number, sha: string): Promise<CommitList> {
    const params = new URLSearchParams({ query: `commit(${sha}) order-by-date`, count: String(COMMIT_LIMIT + 1) })
    for (const field of ['AUTHOR', 'COMMIT_DATE', 'SUBJECT']) params.append('field', field)
    const data = await this.request(`repositories/${id}/commits`, params)
    if (!Array.isArray(data)) throw new ApiError(502, 'invalid_upstream')
    return { hasMore: data.length > COMMIT_LIMIT, commits: data.slice(0, COMMIT_LIMIT).map(value => {
      const row = object(value)
      const author = row.author === null ? null : object(row.author)
      if (typeof row.commitDate !== 'string' && typeof row.commitDate !== 'number') throw new ApiError(502, 'invalid_upstream')
      const date = new Date(row.commitDate)
      if (Number.isNaN(date.getTime())) throw new ApiError(502, 'invalid_upstream')
      return { sha: commitSha(string(row.hash)), subject: string(row.subject), author: author === null ? '—' : string(author.name), date: date.toISOString() }
    }) }
  }
}
