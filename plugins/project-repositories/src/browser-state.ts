import { API, CODE_PAGE } from './shared.ts'
import type { RefType } from './shared.ts'
export interface BrowseState { id: number; refType: RefType; refName: string; sha: string; path: string; kind: 'file' | 'directory'; tab: 'code' | 'commits'; anchor: string }
export function readBrowseState(hash: string): BrowseState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const id = params.get('repo') ?? ''
  if (params.get('console') !== CODE_PAGE || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null
  const path = params.get('path') ?? ''
  const sha = params.get('sha') ?? ''
  if (sha && !/^[a-f0-9]{40}$/i.test(sha)) return null
  if (path.startsWith('/') || /[\x00-\x1f\x7f\\]/.test(path) || path.split('/').some(p => p === '..' || p === '.')) return null
  return { id: Number(id), refType: params.get('type') === 'tag' ? 'tag' : 'branch', refName: params.get('ref') ?? '', sha,
    path, kind: params.get('kind') === 'file' ? 'file' : 'directory', tab: params.get('tab') === 'commits' ? 'commits' : 'code', anchor: params.get('anchor') ?? '' }
}
export function browseHash(state: BrowseState | null): string {
  const params = new URLSearchParams({ console: CODE_PAGE })
  if (state) {
    params.set('repo', String(state.id))
    params.set('type', state.refType)
    if (state.refName) params.set('ref', state.refName)
    if (state.sha) params.set('sha', state.sha)
    if (state.path) params.set('path', state.path)
    params.set('kind', state.kind)
    params.set('tab', state.tab)
    if (state.anchor) params.set('anchor', state.anchor)
  }
  return `#${params}`
}
export function repositoryUrl(id: number, action: string, sha: string, path = ''): string {
  return `${API}/repos/${id}/${action}?${new URLSearchParams({ sha, path })}`
}
export function parentPath(path: string): string { return path.split('/').slice(0, -1).join('/') }
export type RepositoryLink = { kind: 'external'; url: string } | { kind: 'internal'; path: string; directory: boolean; anchor: string } | { kind: 'blocked' }
export function resolveRepositoryLink(file: string, target: string): RepositoryLink {
  if (!target || /[\x00-\x20\x7f\\]/.test(target)) return { kind: 'blocked' }
  if (/^(?:https?:)?\/\//i.test(target)) {
    let url: URL
    try { url = new URL(target.startsWith('//') ? `https:${target}` : target) } catch (cause) { void cause; return { kind: 'blocked' } }
    if (url.username || url.password) return { kind: 'blocked' }
    return { kind: 'external', url: url.href }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return { kind: 'blocked' }
  const hashAt = target.indexOf('#')
  let anchor = hashAt < 0 ? '' : target.slice(hashAt + 1)
  const beforeHash = hashAt < 0 ? target : target.slice(0, hashAt)
  const rawPath = beforeHash.split('?')[0]
  let decoded: string
  try { decoded = decodeURIComponent(rawPath); anchor = decodeURIComponent(anchor) } catch (cause) { void cause; return { kind: 'blocked' } }
  if (/[\x00-\x1f\x7f\\]/.test(decoded)) return { kind: 'blocked' }
  if (!decoded) return { kind: 'internal', path: file, directory: false, anchor }
  const parts = decoded.startsWith('/') ? [] : parentPath(file).split('/').filter(Boolean)
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { if (!parts.length) return { kind: 'blocked' }; parts.pop() } else parts.push(part)
  }
  return { kind: 'internal', path: parts.join('/'), directory: decoded.endsWith('/') || parts.length === 0, anchor }
}
export function readmePath(paths: readonly { path: string; isFile: boolean }[]): string | undefined {
  for (const name of ['readme.md', 'readme.markdown', 'readme']) {
    const entry = paths.find(p => p.isFile && p.path.split('/').at(-1)?.toLowerCase() === name)
    if (entry) return entry.path
  }
  return undefined
}
