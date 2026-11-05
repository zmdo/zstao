import { useEffect, useMemo, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { errorText, json, useLanguage } from './client-api.ts'

interface LocaleFace { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
interface PageProps { locale: LocaleFace }
interface Repository { name: string; tagCount: number; public: boolean; pullCount: number; creationTime: string; updateTime: string; description: string }
interface Tag { name: string; digest: string; size: number; created: string; updated: string; pushed: string; os: string; architecture: string }
interface RepositoryList { repositories: Repository[]; total: number; server: string }

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function shortName(name: string): string {
  const parts = name.split('/')
  return parts.at(-1) ?? name
}

export function ImageRegistryPage(props: PageProps): JSX.Element {
  const zh = useLanguage(props.locale)
  const [data, setData] = useState<RepositoryList | null>(null)
  const [selected, setSelected] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [tagsLoading, setTagsLoading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let stopped = false
    setLoading(true); setError('')
    json<RepositoryList>('/image-registry/repositories?offset=0&limit=50')
      .then(value => { if (!stopped) setData(value) })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [zh, refresh])

  useEffect(() => {
    if (selected === '') { setTags([]); return }
    let stopped = false
    setTagsLoading(true)
    json<{ tags: Tag[] }>(`/image-registry/repositories/${encodeURIComponent(selected)}/tags?offset=0&limit=100`)
      .then(value => { if (!stopped) setTags(value.tags) })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setTagsLoading(false) })
    return () => { stopped = true }
  }, [selected, zh])

  const repositories = useMemo(() => data?.repositories ?? [], [data])
  return (
    <Panel className="smp-list-panel" title={zh ? '项目镜像仓库' : 'Image registry'} extra={
      <div className="row smp-plugins-head-extra">
        <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>{zh ? '刷新' : 'Refresh'}</button>
      </div>
    }>
      {loading && <p className="muted">{zh ? '正在读取…' : 'Loading…'}</p>}
      {error !== '' && <p className="banner error">{error}</p>}
      {!loading && error === '' && repositories.length === 0 && <p className="empty">{zh ? '还没有镜像仓库。' : 'No image repositories yet.'}</p>}
      {repositories.length > 0 && <div className="table-wrap smp-list-scroll"><table className="smp-plugins smp-table"><thead><tr><th>{zh ? '仓库' : 'Repository'}</th><th>Tags</th><th>{zh ? '访问' : 'Access'}</th><th>{zh ? '拉取次数' : 'Pulls'}</th><th>{zh ? '更新时间' : 'Updated'}</th></tr></thead><tbody>{repositories.map(repo => <tr key={repo.name} className={selected === repo.name ? 'smp-plugin-row is-open' : 'smp-plugin-row'} role="button" tabIndex={0} onClick={() => setSelected(current => current === repo.name ? '' : repo.name)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(current => current === repo.name ? '' : repo.name) } }}><td><strong>{shortName(repo.name)}</strong><span className="smp-image-registry-path">{repo.name}</span></td><td>{repo.tagCount}</td><td><span className={`pill ${repo.public ? 'online' : 'offline'}`}>{repo.public ? (zh ? '公开' : 'Public') : (zh ? '私有' : 'Private')}</span></td><td>{repo.pullCount}</td><td>{repo.updateTime || '—'}</td></tr>)}</tbody></table></div>}
      {selected !== '' && <section className="smp-image-registry-tags"><h3>{selected} <span className="muted">Tags</span></h3>{tagsLoading ? <p className="muted">{zh ? '正在读取 Tags…' : 'Loading tags…'}</p> : tags.length === 0 ? <p className="muted">{zh ? '没有 Tag' : 'No tags'}</p> : <div className="table-wrap"><table className="smp-table"><thead><tr><th>Tag</th><th>Digest</th><th>{zh ? '大小' : 'Size'}</th><th>{zh ? '平台' : 'Platform'}</th><th>{zh ? '推送时间' : 'Pushed'}</th></tr></thead><tbody>{tags.map(tag => <tr key={tag.name}><td><code>{tag.name}</code></td><td><code>{tag.digest.slice(0, 20)}…</code></td><td>{bytes(tag.size)}</td><td>{[tag.os, tag.architecture].filter(Boolean).join('/') || '—'}</td><td>{tag.pushed || '—'}</td></tr>)}</tbody></table></div>}</section>}
      {data !== null && <div className="smp-list-pager"><span className="muted">{zh ? `共 ${data.total} 个仓库` : `${data.total} repositories`}</span></div>}
    </Panel>
  )
}
