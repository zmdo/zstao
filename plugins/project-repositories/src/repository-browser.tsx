import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { CodeBlock, FileTypeIcon, IconChevronLeftOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, classifyFileType, languageForPath } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommitList, FilePreview, LatestCommit, Project, Repository, Tree, TreeEntry } from './shared.ts'
import { browseHash, parentPath, readBrowseState, readmePath, repositoryUrl } from './browser-state.ts'
import type { BrowseState } from './browser-state.ts'
import { errorText, json, RequestError, useLanguage } from './client-api.ts'
import type { LocaleFace } from './client-api.ts'
import { RepositoryMarkdown } from './repository-markdown.tsx'

type Navigate = (state: BrowseState | null, replace?: boolean) => void
const filename = (path: string) => path.split('/').at(-1) ?? path
function EntryIcon(props: { entry: TreeEntry; expanded?: boolean }) {
  return <span className="smp-repo-icon">{props.entry.isFile ? <FileTypeIcon kind={classifyFileType(filename(props.entry.path))} /> : props.expanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}</span>
}
function ErrorNotice(props: { error: unknown; zh: boolean; settings?: () => void }) {
  return <p className="smp-project-notice error" role="alert">{errorText(props.error, props.zh)} {props.settings && <button className="link" type="button" onClick={props.settings}>{props.zh ? '打开项目管理' : 'Project management'}</button>}</p>
}
export function CodeRepositoriesPage(props: { locale: LocaleFace; openConsole?: (id: string) => void }) {
  const zh = useLanguage(props.locale)
  const [state, setState] = useState(() => readBrowseState(window.location.hash))
  useEffect(() => {
    const sync = () => setState(readBrowseState(window.location.hash))
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync) }
  }, [])
  const navigate: Navigate = (next, replace = false) => {
    const hash = browseHash(next)
    if (hash !== window.location.hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', hash)
    setState(next)
  }
  return state ? <RepositoryView key={state.id} state={state} navigate={navigate} zh={zh} settings={() => props.openConsole?.('project-management')} />
    : <ProjectList zh={zh} navigate={navigate} settings={() => props.openConsole?.('project-management')} />
}
function ProjectList(props: { zh: boolean; navigate: Navigate; settings(): void }) {
  const { zh } = props
  const [projects, setProjects] = useState<Project[]>([])
  const [offset, setOffset] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    json<{ projects: Project[]; nextOffset: number | null }>(`/projects?offset=${offset}`, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) { setProjects(current => offset === 0 ? body.projects : [...current, ...body.projects.filter(p => !current.some(c => c.id === p.id))]); setNextOffset(body.nextOffset) } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, reload])
  const open = (p: Project) => { if (p.codeManagement) props.navigate({ id: p.id, refType: 'branch', refName: '', sha: '', path: '', kind: 'directory', tab: 'code', anchor: '' }) }
  const filtered = projects.filter(p => `${p.name} ${p.path} ${p.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <Panel className="smp-project-panel smp-repo-panel" title={zh ? '项目代码仓库' : 'Code repositories'} extra={<div className="smp-project-toolbar">
    <input type="search" aria-label={zh ? '搜索已加载项目' : 'Search loaded projects'} placeholder={zh ? '搜索已加载项目' : 'Search loaded projects'} value={query} onChange={e => setQuery(e.target.value)} />
    <button className="secondary" type="button" disabled={loading} onClick={() => { setOffset(0); setReload(v => v + 1) }}>{zh ? '刷新' : 'Refresh'}</button>
  </div>}>
    {error !== null && <ErrorNotice error={error} zh={zh} settings={props.settings} />}
    <div className="table-wrap"><table className="smp-table smp-project-table"><thead><tr><th>{zh ? '项目' : 'Project'}</th><th>{zh ? '路径' : 'Path'}</th><th>{zh ? '说明' : 'Description'}</th><th>{zh ? '能力' : 'Capabilities'}</th><th /></tr></thead>
      <tbody>{filtered.map(project => <tr key={project.id} className={project.codeManagement ? 'smp-repo-clickable' : ''} onClick={() => open(project)}>
        <td><button type="button" className="link" disabled={!project.codeManagement} onClick={event => { event.stopPropagation(); open(project) }}>{project.name}</button></td><td className="mono">{project.path}</td><td>{project.description}</td>
        <td>{project.codeManagement ? (zh ? '代码' : 'Code') : (zh ? '未开启代码管理' : 'Code disabled')}</td>
        <td><a href={project.webUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{zh ? '打开 OneDev' : 'Open OneDev'}</a></td>
      </tr>)}</tbody></table></div>
    {!loading && !filtered.length && error === null && <p className="smp-project-muted">{query ? (zh ? '已加载项目中没有匹配项。' : 'No match in loaded projects.') : (zh ? 'OneDev 中还没有项目。' : 'No projects yet.')}</p>}
    {loading && <p role="status">{zh ? '正在读取…' : 'Loading…'}</p>}
    <p className="smp-project-muted">{zh ? `已加载 ${projects.length} 个项目；搜索仅过滤已加载项目。` : `${projects.length} projects loaded. Search filters loaded projects only.`}</p>
    {nextOffset !== null && <button className="secondary" type="button" disabled={loading} onClick={() => { if (error !== null) setReload(v => v + 1); else setOffset(nextOffset) }}>{error !== null ? (zh ? '重试' : 'Retry') : (zh ? '加载更多项目' : 'Load more projects')}</button>}
  </Panel>
}
function RepositoryView(props: { state: BrowseState; navigate: Navigate; zh: boolean; settings(): void }) {
  const { state, navigate, zh } = props
  const [repo, setRepo] = useState<Repository | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reload, setReload] = useState(0)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setRepo(null); setError(null)
    json<Repository>(`/repos/${state.id}`, { signal: controller.signal }).then(body => { if (!controller.signal.aborted) setRepo(body) }).catch(cause => { if (!controller.signal.aborted) setError(cause) })
    return () => controller.abort()
  }, [state.id, reload])
  const refName = state.refName || repo?.defaultBranch || ''
  useEffect(() => {
    if (!repo || state.sha || !refName) return
    const controller = new AbortController()
    setError(null)
    json<{ sha: string }>(`/repos/${state.id}/resolve?${new URLSearchParams({ type: state.refType, name: refName })}`, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) navigate({ ...state, refName, sha: body.sha }, true) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause) })
    return () => controller.abort()
  }, [repo, state.id, state.refType, refName, state.sha, state.path, state.kind, state.tab, state.anchor])
  const copyClone = async (value: string): Promise<void> => {
    try { await navigator.clipboard.writeText(value); setNotice(zh ? '克隆地址已复制' : 'Clone URL copied') } catch (cause) { void cause; setNotice(zh ? '复制失败，请手动复制。' : 'Copy failed. Copy it manually.') }
  }
  const title = <span className="smp-repo-title">
    <button type="button" className="smp-repo-back" aria-label={zh ? '返回项目列表' : 'All projects'} title={zh ? '返回项目列表' : 'All projects'} onClick={() => navigate(null)}><IconChevronLeftOutlineRegular /></button>
    <strong>{repo?.project.name ?? (zh ? '仓库详情' : 'Repository')}</strong>
    {(repo?.project.description || repo?.project.path) && <>
      <span className="smp-repo-title-divider" aria-hidden="true" />
      <span className="smp-repo-title-description">{repo?.project.description || repo?.project.path}</span>
    </>}
  </span>
  return <Panel className="smp-project-panel smp-repo-panel smp-repo-detail" title={title} extra={repo && <button type="button" className="secondary" onClick={() => window.open(repo.project.webUrl, '_blank', 'noopener,noreferrer')}>{zh ? '打开 OneDev' : 'Open OneDev'}</button>}>
    {error !== null && <><ErrorNotice error={error} zh={zh} settings={props.settings} /><button type="button" className="secondary" onClick={() => setReload(v => v + 1)}>{zh ? '重试' : 'Retry'}</button></>}
    {!repo && error === null && <p role="status">{zh ? '正在读取仓库…' : 'Loading repository…'}</p>}
    {repo && <>
      <nav className="smp-repo-tabs" aria-label={zh ? '仓库栏目' : 'Repository sections'}>{(['code', 'commits'] as const).map(tab => <button type="button" key={tab} aria-current={state.tab === tab ? 'page' : undefined} className={state.tab === tab ? 'is-on' : ''} onClick={() => navigate({ ...state, tab, anchor: '' })}>{tab === 'code' ? (zh ? '代码' : 'Code') : (zh ? '提交' : 'Commits')}</button>)}</nav>
      <div className="smp-repo-toolbar">
        <select aria-label={zh ? '分支或 Tag' : 'Branch or tag'} value={JSON.stringify([state.refType, refName])} disabled={!repo.branches.length && !repo.tags.length} onChange={e => { const [refType, name] = JSON.parse(e.target.value); setError(null); navigate({ ...state, refType, refName: name, sha: '', anchor: '' }) }}>
          {!refName && <option value={JSON.stringify(['branch', ''])}>{zh ? '无默认分支' : 'No default branch'}</option>}
          {refName && !(state.refType === 'branch' ? repo.branches : repo.tags).includes(refName) && <option value={JSON.stringify([state.refType, refName])}>{refName}</option>}
          <optgroup label={zh ? '分支' : 'Branches'}>{repo.branches.map(name => <option key={name} value={JSON.stringify(['branch', name])}>{name}</option>)}</optgroup>
          <optgroup label="Tags">{repo.tags.map(name => <option key={name} value={JSON.stringify(['tag', name])}>{name}</option>)}</optgroup>
        </select>
        {state.sha && <code title={state.sha}>{state.sha.slice(0, 12)}</code>}
        <details className="smp-repo-clone">
          <summary className="smp-repo-clone-trigger">{zh ? '克隆地址' : 'Clone URL'}</summary>
          <div className="smp-repo-clone-popover">
            <label><span>HTTP</span><span className="smp-repo-clone-line"><input readOnly value={repo.cloneUrls?.http || repo.cloneUrl} aria-label="HTTP clone URL" /><button type="button" className="secondary" onClick={() => { void copyClone(repo.cloneUrls?.http || repo.cloneUrl) }}>{zh ? '复制' : 'Copy'}</button></span></label>
            {repo.cloneUrls?.ssh && <label><span>SSH</span><span className="smp-repo-clone-line"><input readOnly value={repo.cloneUrls.ssh} aria-label="SSH clone URL" /><button type="button" className="secondary" onClick={() => { void copyClone(repo.cloneUrls.ssh) }}>{zh ? '复制' : 'Copy'}</button></span></label>}
            {notice && <span role="status" className="smp-repo-clone-notice">{notice}</span>}
          </div>
        </details>
      </div>
      {!refName && !state.sha ? <p>{zh ? '仓库尚未初始化。' : 'This repository has not been initialized.'}</p> : !state.sha ? (error === null && <p role="status">{zh ? '正在解析引用…' : 'Resolving reference…'}</p>) : <Snapshot key={`${state.id}:${state.sha}`} state={state} navigate={navigate} zh={zh} webUrl={repo.project.webUrl} />}
    </>}
  </Panel>
}

function Snapshot(props: { state: BrowseState; navigate: Navigate; zh: boolean; webUrl: string }) {
  const { state, navigate, zh } = props
  const [trees, setTrees] = useState<Record<string, Tree>>({})
  const [treeError, setTreeError] = useState<unknown>(null)
  const [content, setContent] = useState<{ directory?: Tree; file?: FilePreview }>({})
  const [latest, setLatest] = useState<Record<string, LatestCommit | null>>({})
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const controllers = useRef(new Set<AbortController>())
  const cache = useRef(new Map<string, Promise<Tree>>())
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => () => { for (const controller of controllers.current) controller.abort(); cache.current.clear() }, [])
  const loadTree = useCallback((path: string): Promise<Tree> => {
    const existing = cache.current.get(path)
    if (existing) return existing
    const controller = new AbortController()
    controllers.current.add(controller)
    const pending = json<Tree>(repositoryUrl(state.id, 'tree', state.sha, path), { signal: controller.signal }).then(tree => {
      if (!controller.signal.aborted) setTrees(current => ({ ...current, [path]: tree }))
      return tree
    }).catch(cause => { cache.current.delete(path); throw cause }).finally(() => controllers.current.delete(controller))
    cache.current.set(path, pending)
    return pending
  }, [state.id, state.sha])
  useEffect(() => {
    let active = true
    setTreeError(null)
    loadTree('').catch(cause => { if (active) setTreeError(cause) })
    return () => { active = false }
  }, [loadTree, reload])
  useEffect(() => {
    if (state.tab !== 'code') return
    const controller = new AbortController()
    setContent({}); setError(null); setLoading(true)
    const run = async () => {
      if (state.kind === 'directory') {
        const directory = await loadTree(state.path)
        if (controller.signal.aborted) return
        setContent({ directory })
        const readme = readmePath(directory.entries)
        if (readme) {
          const file = await json<FilePreview>(repositoryUrl(state.id, 'file', state.sha, readme), { signal: controller.signal })
          if (!controller.signal.aborted) setContent({ directory, file })
        }
      } else {
        let file: FilePreview
        try { file = await json<FilePreview>(repositoryUrl(state.id, 'file', state.sha, state.path), { signal: controller.signal }) } catch (cause) {
          if (!(cause instanceof RequestError) || cause.code !== 'unsupported_entry') throw cause
          await loadTree(state.path)
          if (!controller.signal.aborted) navigate({ ...state, kind: 'directory' }, true)
          return
        }
        if (!controller.signal.aborted) setContent({ file })
      }
    }
    void run().catch(cause => { if (!controller.signal.aborted) setError(cause) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [state.id, state.sha, state.path, state.kind, state.tab, loadTree, reload])
  useEffect(() => {
    if (!content.directory) return
    const controller = new AbortController()
    let active = true
    const entries = content.directory.entries
    void Promise.all(entries.map(entry => json<LatestCommit | null>(repositoryUrl(state.id, 'latest', state.sha, entry.path), { signal: controller.signal }).catch(() => null)))
      .then(values => { if (!active) return; const next: Record<string, LatestCommit | null> = {}; entries.forEach((entry, index) => { next[entry.path] = values[index] ?? null }); setLatest(next) })
      .catch(() => { if (active) setLatest({}) })
    return () => { active = false; controller.abort() }
  }, [content.directory, state.id, state.sha])
  useEffect(() => {
    if (!state.anchor || loading) return
    const target = Array.from(body.current?.querySelectorAll<HTMLElement>('[id]') ?? []).find(el => el.id === `smp-repo-heading-${state.anchor}`)
    target?.scrollIntoView({ block: 'start' })
  }, [state.anchor, loading, content])
  const openEntry = (entry: TreeEntry) => navigate({ ...state, path: entry.path, kind: entry.isFile ? 'file' : 'directory', tab: 'code', anchor: '' })
  if (state.tab === 'commits') return <Commits state={state} zh={zh} webUrl={props.webUrl} />
  const directoryPath = state.kind === 'directory' ? state.path : parentPath(state.path)
  const crumbs = state.path.split('/').filter(Boolean)
  return <>
    <div className="smp-repo-pathbar">
      <nav aria-label={zh ? '文件路径' : 'File path'}><button type="button" className="link" onClick={() => navigate({ ...state, path: '', kind: 'directory', anchor: '' })}>/</button>{crumbs.map((part, i) => <span key={i}><span aria-hidden="true">{i > 0 ? ' / ' : ''}</span><button type="button" className="link" onClick={() => navigate({ ...state, path: crumbs.slice(0, i + 1).join('/'), kind: i === crumbs.length - 1 ? state.kind : 'directory', anchor: '' })}>{part}</button></span>)}</nav>
    </div>
    <div className="smp-repo-browser">
      <nav className="smp-repo-tree" aria-label={zh ? '仓库目录' : 'Repository tree'}>
        {treeError !== null && <ErrorNotice error={treeError} zh={zh} />}
        {!trees[''] && treeError === null && <p>{zh ? '正在读取…' : 'Loading…'}</p>}
        {(trees['']?.entries ?? []).map(entry => <TreeRow key={entry.path} entry={entry} trees={trees} load={loadTree} open={openEntry} selected={state.path} directory={directoryPath} zh={zh} depth={0} />)}
        {trees['']?.truncated && <p>{zh ? '目录过大，仅展示前 2,000 项。' : 'Only the first 2,000 entries are shown.'}</p>}
      </nav>
      <div className="smp-repo-main" ref={body}>
        {loading && <p role="status">{zh ? '正在读取…' : 'Loading…'}</p>}
        {error !== null && <><ErrorNotice error={error} zh={zh} /><button type="button" className="secondary" onClick={() => setReload(v => v + 1)}>{zh ? '重试' : 'Retry'}</button></>}
        {state.path && <button type="button" className="link smp-repo-parent" onClick={() => navigate({ ...state, path: parentPath(state.path), kind: 'directory', anchor: '' })}>← {zh ? '返回上级目录' : 'Parent directory'}</button>}
        {content.directory && <div className="smp-repo-directory">
          {content.directory.entries.map(entry => <button type="button" key={entry.path} className="smp-repo-directory-entry" onClick={() => openEntry(entry)}>
            <span className="smp-repo-entry-main"><EntryIcon entry={entry} /><span>{filename(entry.path)}</span></span>
            {latest[entry.path] && <span className="smp-repo-last-commit">{latest[entry.path]?.subject}</span>}
          </button>)}
          {!content.directory.entries.length && <p>{zh ? '此目录没有文件。' : 'This directory is empty.'}</p>}
          {content.directory.truncated && <p>{zh ? '目录过大，仅展示前 2,000 项，请在 OneDev 中查看完整目录。' : 'Only the first 2,000 entries are shown. Open OneDev for the full directory.'}</p>}
        </div>}
        {content.file && <FileView key={`${content.file.path}:${content.file.truncated}`} file={content.file} state={state} navigate={navigate} zh={zh} />}
      </div>
    </div>
  </>
}
function TreeRow(props: { entry: TreeEntry; trees: Record<string, Tree>; load(path: string): Promise<Tree>; open(entry: TreeEntry): void; selected: string; directory: string; zh: boolean; depth: number }) {
  const { entry, zh } = props
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const ancestor = props.directory === entry.path || props.directory.startsWith(`${entry.path}/`)
  useEffect(() => { if (ancestor && !entry.isFile) setExpanded(true) }, [ancestor, entry.isFile])
  useEffect(() => {
    if (!expanded || entry.isFile) return
    let active = true
    setError(null)
    props.load(entry.path).catch(cause => { if (active) setError(cause) })
    return () => { active = false }
  }, [expanded, entry.path, props.load])
  return <div>
    <div className={`smp-repo-tree-row${props.selected === entry.path ? ' is-current' : ''}`} style={{ paddingLeft: props.depth * 12 }}>
      {!entry.isFile && <button type="button" className="smp-repo-expander" aria-label={`${expanded ? (zh ? '折叠' : 'Collapse') : (zh ? '展开' : 'Expand')} ${filename(entry.path)}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '▾' : '▸'}</button>}
      <button type="button" className="smp-repo-tree-name" onClick={() => props.open(entry)}><EntryIcon entry={entry} expanded={expanded} /><span>{filename(entry.path)}</span></button>
    </div>
    {expanded && <>
      {error !== null && <ErrorNotice error={error} zh={zh} />}
      {!props.trees[entry.path] && error === null && <small>{zh ? '正在读取…' : 'Loading…'}</small>}
      {(props.trees[entry.path]?.entries ?? []).map(child => <TreeRow {...props} key={child.path} entry={child} depth={props.depth + 1} />)}
      {props.trees[entry.path]?.truncated && <small>{zh ? '仅展示前 2,000 项。' : 'First 2,000 entries only.'}</small>}
    </>}
  </div>
}
function FileView(props: { file: FilePreview; state: BrowseState; navigate: Navigate; zh: boolean }) {
  const { file, zh } = props
  const [source, setSource] = useState(false)
  const markdown = /\.(md|markdown)$/i.test(file.path) || filename(file.path).toLowerCase() === 'readme'
  const lang = languageForPath(file.path) ?? ''
  return <section className="smp-repo-file">
    <header><strong>{file.path}</strong><span>{file.size.toLocaleString()} B</span>
      {markdown && !file.truncated && !file.binary && <button type="button" className="secondary" onClick={() => setSource(v => !v)}>{source ? (zh ? '预览' : 'Preview') : (zh ? '源码' : 'Source')}</button>}
      {file.downloadable && <a href={repositoryUrl(props.state.id, 'raw', props.state.sha, file.path)} download>{zh ? '下载原始文件' : 'Download raw file'}</a>}
    </header>
    {file.truncated && <p className="smp-repo-warning">{zh ? '内容已截断（最多 200 KiB / 5,000 行，或上游仅返回部分内容）。' : 'Content is truncated (200 KiB / 5,000 lines, or a partial upstream response).'}</p>}
    {!file.downloadable && <p className="smp-project-muted">{zh ? '完整文件请通过 OneDev 下载。' : 'Download the complete file from OneDev.'}</p>}
    {file.binary ? <p>{zh ? '二进制或非 UTF-8 文件，无法预览。' : 'Binary or non-UTF-8 file. Preview is unavailable.'}</p> : markdown && !source && !file.truncated ? <RepositoryMarkdown text={file.content} file={file.path} state={props.state} navigate={props.navigate} zh={zh} /> : lang && file.highlight ? <CodeBlock code={file.content} lang={lang} lineNumbers copyLabel={zh ? '复制' : 'Copy'} copiedLabel={zh ? '已复制' : 'Copied'} toolbarLabels={{ codeLabel: zh ? '代码' : 'Code', wrapLabel: zh ? '换行' : 'Wrap', unwrapLabel: zh ? '不换行' : 'Unwrap' }} /> : <pre className="smp-repo-source">{file.content}</pre>}
  </section>
}
function Commits(props: { state: BrowseState; zh: boolean; webUrl: string }) {
  const [data, setData] = useState<CommitList | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError(null)
    json<CommitList>(repositoryUrl(props.state.id, 'commits', props.state.sha), { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value) }).catch(cause => { if (!controller.signal.aborted) setError(cause) })
    return () => controller.abort()
  }, [props.state.id, props.state.sha, reload])
  return <section className="smp-repo-commits">
    <p className="smp-project-muted">{props.zh ? '当前快照可达的最近 100 条提交' : 'Up to 100 most recent commits reachable from this snapshot'}</p>
    {error !== null && <><ErrorNotice error={error} zh={props.zh} /><button type="button" className="secondary" onClick={() => setReload(v => v + 1)}>{props.zh ? '重试' : 'Retry'}</button></>}
    {!data && error === null && <p role="status">{props.zh ? '正在读取…' : 'Loading…'}</p>}
    {data?.commits.map(commit => <article key={commit.sha}><div><strong>{commit.subject}</strong><p>{commit.author} · <time dateTime={commit.date}>{new Date(commit.date).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</time></p></div><code title={commit.sha}>{commit.sha.slice(0, 12)}</code></article>)}
    {data?.commits.length === 0 && <p>{props.zh ? '暂无提交。' : 'No commits.'}</p>}
    {data?.hasMore && <p>{props.zh ? '还有更早的提交。' : 'Earlier commits are available.'} <a href={`${props.webUrl}/~commits`} target="_blank" rel="noopener noreferrer">{props.zh ? '在 OneDev 中查看' : 'View in OneDev'}</a></p>}
  </section>
}
