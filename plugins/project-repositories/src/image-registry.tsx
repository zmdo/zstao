import { useEffect, useMemo, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, json, useLanguage } from './client-api.ts'

interface LocaleFace { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
interface PageProps { locale: LocaleFace }
interface Repository { name: string; tagCount: number; public: boolean; pullCount: number; creationTime: string; updateTime: string; description: string }
interface Tag { name: string; digest: string; size: number; created: string; updated: string; pushed: string; os: string; architecture: string }
interface RepositoryList { repositories: Repository[]; total: number; server: string }
const PAGE_SIZES = [20, 50, 100]

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function shortName(name: string): string {
  return name.split('/').at(-1) ?? name
}
function hashRepo(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('repo') ?? ''
}
function setHashRepo(name: string): void {
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (name === '') params.delete('repo')
  else params.set('repo', name)
  const next = `#${params.toString()}`
  if (next !== window.location.hash) window.history.pushState(null, '', next)
}
function pagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function ImageRegistryPage(props: PageProps): JSX.Element {
  const zh = useLanguage(props.locale)
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [total, setTotal] = useState(0)
  const [server, setServer] = useState('')
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => hashRepo())
  const [tags, setTags] = useState<Tag[]>([])
  const [tagTotal, setTagTotal] = useState(0)
  const [tagOffset, setTagOffset] = useState(0)
  const [tagPageSize, setTagPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [tagLoading, setTagLoading] = useState(false)
  const [error, setError] = useState('')
  const [tagRefresh, setTagRefresh] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const sync = () => setSelected(hashRepo())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    let stopped = false
    setLoading(true); setError('')
    const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize) })
    if (query.trim() !== '') params.set('repo', query.trim())
    json<RepositoryList>(`/image-registry/repositories?${params}`)
      .then(value => { if (!stopped) { setRepositories(value.repositories); setTotal(value.total); setServer(value.server) } })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [offset, pageSize, query, zh])

  useEffect(() => {
    if (selected === '') { setTags([]); setTagTotal(0); return }
    let stopped = false
    setTagLoading(true); setError('')
    json<{ tags: Tag[]; total: number }>(`/image-registry/repositories/${encodeURIComponent(selected)}/tags?offset=${tagOffset}&limit=${tagPageSize}`)
      .then(value => { if (!stopped) { setTags(value.tags); setTagTotal(value.total) } })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setTagLoading(false) })
    return () => { stopped = true }
  }, [selected, tagOffset, tagPageSize, tagRefresh, zh])

  useEffect(() => {
    if (server !== '' || selected === '') return
    let stopped = false
    json<{ registry: string }>('/image-registry/settings')
      .then(value => { if (!stopped) setServer(value.registry) })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
    return () => { stopped = true }
  }, [server, selected, zh])

  const pages = pagesOf(total, pageSize)
  const tagPages = pagesOf(tagTotal, tagPageSize)
  const selectedRepo = useMemo(() => repositories.find(repo => repo.name === selected), [repositories, selected])
  const registry = server || 'ccr.ccs.tencentyun.com'
  const open = (name: string): void => { setSelected(name); setHashRepo(name); setTagOffset(0); setDeleteTarget(null) }
  const back = (): void => { setSelected(''); setHashRepo(''); setDeleteTarget(null) }
  const copy = async (value: string): Promise<void> => {
    try { await navigator.clipboard.writeText(value); setNotice(zh ? '镜像地址已复制' : 'Image address copied') } catch (cause) { void cause; setNotice(zh ? '复制失败，请手动复制。' : 'Copy failed; copy it manually.') }
  }
  const addressOf = (tag: string): string => `${registry}/${selected}:${tag}`
  const remove = async (): Promise<void> => {
    if (deleteTarget === null) return
    setDeleting(true); setError(''); setNotice('')
    try {
      await json<{ ok: boolean }>(`/image-registry/repositories/${encodeURIComponent(selected)}/tags/${encodeURIComponent(deleteTarget.name)}/delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      setNotice(zh ? `已删除 ${deleteTarget.name}` : `Deleted ${deleteTarget.name}`)
      setDeleteTarget(null)
      setTagRefresh(value => value + 1)
    } catch (cause) { setError(errorText(cause, zh)) } finally { setDeleting(false) }
  }

  if (selected !== '') {
    return (
      <Panel className="smp-list-panel" title={
        <span className="smp-pipeline-titlebar">
          <button type="button" className="smp-repo-back" aria-label={zh ? '返回镜像仓库列表' : 'Back to repositories'} title={zh ? '返回镜像仓库列表' : 'Back to repositories'} onClick={back}><IconChevronLeftOutlineRegular /></button>
          <strong>{shortName(selected)}</strong>
        </span>
      } extra={<span className="smp-image-registry-server">{registry}/{selected}</span>}>
        {error !== '' && <p className="banner error">{error}</p>}
        <div className="smp-image-registry-info">
          <div><span>{zh ? '仓库' : 'Repository'}</span><strong>{selected}</strong></div>
          <div><span>Tags</span><strong>{tagTotal}</strong></div>
          <div><span>{zh ? '访问' : 'Access'}</span><strong>{selectedRepo?.public ? (zh ? '公开' : 'Public') : (zh ? '私有' : 'Private')}</strong></div>
          <div><span>Registry</span><strong>{registry}</strong></div>
        </div>
        {tagLoading ? <p className="muted">{zh ? '正在读取 Tag…' : 'Loading tags…'}</p> : tags.length === 0 ? <p className="empty">{zh ? '没有 Tag' : 'No tags'}</p> : <div className="table-wrap smp-list-scroll"><table className="smp-plugins smp-table"><thead><tr><th>Tag</th><th>{zh ? '地址' : 'Address'}</th><th>Digest</th><th>{zh ? '大小' : 'Size'}</th><th>{zh ? '平台' : 'Platform'}</th><th>{zh ? '推送时间' : 'Pushed'}</th><th className="smp-image-action-head">{zh ? '操作' : 'Actions'}</th></tr></thead><tbody>{tags.map(tag => <tr key={tag.name}><td><code>{tag.name}</code></td><td className="smp-image-address-cell"><span className="smp-image-address-value"><code>{addressOf(tag.name)}</code><button type="button" className="secondary" aria-label={zh ? '复制镜像地址' : 'Copy image address'} title={zh ? '复制镜像地址' : 'Copy image address'} onClick={() => { void copy(addressOf(tag.name)) }}>{zh ? '复制' : 'Copy'}</button></span></td><td><code>{tag.digest.slice(0, 20)}…</code></td><td>{bytes(tag.size)}</td><td>{[tag.os, tag.architecture].filter(Boolean).join('/') || '—'}</td><td>{tag.pushed || '—'}</td><td className="smp-image-action-cell"><button type="button" className="secondary smp-danger-button" onClick={() => setDeleteTarget(tag)}>{zh ? '删除' : 'Delete'}</button></td></tr>)}</tbody></table></div>}
        {notice !== '' && <p className="smp-project-notice ok">{notice}</p>}
        {tags.length > 0 && <div className="smp-plugins-pager smp-list-pager"><span className="muted">{zh ? `共 ${tagTotal} 个 Tag` : `${tagTotal} tags`}</span><div className="row"><label>{zh ? '每页' : 'Per page'}<select className="smp-page-size" value={tagPageSize} onChange={event => { setTagPageSize(Number(event.target.value)); setTagOffset(0) }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label><button type="button" className="secondary" disabled={tagOffset === 0 || tagLoading} onClick={() => setTagOffset(Math.max(0, tagOffset - tagPageSize))}>{zh ? '上一页' : 'Previous'}</button><span>{zh ? `第 ${Math.floor(tagOffset / tagPageSize) + 1} / ${tagPages} 页` : `Page ${Math.floor(tagOffset / tagPageSize) + 1} of ${tagPages}`}</span><button type="button" className="secondary" disabled={tagOffset + tagPageSize >= tagTotal || tagLoading} onClick={() => setTagOffset(tagOffset + tagPageSize)}>{zh ? '下一页' : 'Next'}</button></div></div>}
        {deleteTarget !== null && <div className="smp-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null) }}><div className="smp-modal" role="dialog" aria-modal="true" aria-labelledby="smp-delete-image-title"><h3 id="smp-delete-image-title">{zh ? '删除镜像版本' : 'Delete image tag'}</h3><p>{zh ? '确认删除以下镜像版本？删除后无法恢复。' : 'Delete this image tag? This cannot be undone.'}</p><code className="smp-modal-target">{addressOf(deleteTarget.name)}</code><div className="smp-modal-actions"><button type="button" className="secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary smp-danger-button" disabled={deleting} onClick={() => { void remove() }}>{deleting ? (zh ? '删除中…' : 'Deleting…') : (zh ? '确认删除' : 'Delete')}</button></div></div></div>}
      </Panel>
    )
  }

  return (
    <Panel className="smp-list-panel" title={zh ? '项目镜像仓库' : 'Image registry'} extra={
      <div className="row smp-plugins-head-extra">
        <input className="search" type="search" value={query} aria-label={zh ? '搜索镜像仓库' : 'Search repositories'} placeholder={zh ? '搜索镜像仓库' : 'Search repositories'} onChange={event => { setQuery(event.target.value); setOffset(0) }} />
      </div>
    }>
      {loading && <p className="muted">{zh ? '正在读取…' : 'Loading…'}</p>}
      {error !== '' && <p className="banner error">{error}</p>}
      {!loading && error === '' && repositories.length === 0 && <p className="empty">{zh ? '没有匹配的镜像仓库。' : 'No matching image repositories.'}</p>}
      {repositories.length > 0 && <div className="table-wrap smp-list-scroll"><table className="smp-plugins smp-table"><thead><tr><th>{zh ? '仓库' : 'Repository'}</th><th>Tags</th><th>{zh ? '访问' : 'Access'}</th><th>{zh ? '拉取次数' : 'Pulls'}</th><th>{zh ? '更新时间' : 'Updated'}</th></tr></thead><tbody>{repositories.map(repo => <tr key={repo.name} className="smp-plugin-row" role="button" tabIndex={0} onClick={() => open(repo.name)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(repo.name) } }}><td><strong>{shortName(repo.name)}</strong><span className="smp-image-registry-path">{repo.name}</span></td><td>{repo.tagCount}</td><td><span className={`pill ${repo.public ? 'online' : 'offline'}`}>{repo.public ? (zh ? '公开' : 'Public') : (zh ? '私有' : 'Private')}</span></td><td>{repo.pullCount}</td><td>{repo.updateTime || '—'}</td></tr>)}</tbody></table></div>}
      {repositories.length > 0 && <div className="smp-plugins-pager smp-list-pager"><span className="muted">{zh ? `共 ${total} 个` : `${total} repositories`}</span><div className="row"><label>{zh ? '每页' : 'Per page'}<select className="smp-page-size" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setOffset(0) }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label><button type="button" className="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>{zh ? '上一页' : 'Previous'}</button><span>{zh ? `第 ${Math.floor(offset / pageSize) + 1} / ${pages} 页` : `Page ${Math.floor(offset / pageSize) + 1} of ${pages}`}</span><button type="button" className="secondary" disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)}>{zh ? '下一页' : 'Next'}</button></div></div>}
    </Panel>
  )
}
