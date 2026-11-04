import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Panel } from '@smp/console-kit'
import { CodeBlock, FileTypeIcon, IconFolderCloseRegular, IconFolderOpenRegular, MarkdownText, classifyFileType, languageForPath } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './pages/catalog.css'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

interface PageSlots {
  inject(name: string, register: () => () => void): void
  register(options: object, component: unknown): () => void
}

interface ClientCtx {
  slots: PageSlots
  locale: LocaleFace
  effect(run: () => (() => void)): void
}

interface PageLabel {
  (): string
  group?: string
  groupLabel?: string | (() => string)
  icon?: string
}

interface Skill {
  name: string
  description: string
  whenToUse: string
  path: string
  source: string
  provider: string
  modelInvocable: boolean
  userInvocable: boolean
  enabled: boolean
  editable: boolean
}

interface Tool {
  name: string
  description: string
  provider: string
  providerPackage: string
}

interface Inspection {
  valid: boolean
  name?: string
  description?: string
  whenToUse?: string
  path?: string
  files?: Array<{ path: string; size: number; executable: boolean }>
  error?: string
}

interface FileEntry {
  name: string
  path: string
  type: 'directory' | 'file'
  size: number | null
}

interface FilePreview {
  path: string
  binary: boolean
  content: string
  size: number
}

const SKILLS_PAGE = 'harness-skills'
const TOOLS_PAGE = 'harness-tools'
const PAGE_SIZE = [20, 50, 100]

function pageLabel(text: () => string, icon: string): PageLabel {
  const label: PageLabel = () => text()
  label.group = 'agent'
  label.groupLabel = 'Harness'
  label.icon = icon
  return label
}

function copyOf(active: string) {
  const zh = active !== 'en'
  return {
    skills: zh ? 'Skill' : 'Skills',
    tools: zh ? '工具' : 'Tools',
    skillsTitle: zh ? 'Skill' : 'Skills',
    toolsTitle: zh ? '工具' : 'Tools',
    name: zh ? '名称' : 'Name',
    description: zh ? '说明' : 'Description',
    source: zh ? '来源' : 'Source',
    provider: zh ? '提供插件' : 'Provided by',
    status: zh ? '状态' : 'Status',
    actions: zh ? '操作' : 'Actions',
    search: zh ? '搜索' : 'Search',
    loading: zh ? '正在读取…' : 'Loading…',
    empty: zh ? '还没有安装 Skill' : 'No skills installed',
    noMatch: zh ? '没有匹配项' : 'No matches',
    import: zh ? '导入 Skill' : 'Import skill',
    importOk: zh ? '已导入' : 'Imported',
    importFailed: zh ? '导入失败' : 'Import failed',
    path: zh ? '路径' : 'Path',
    when: zh ? '适用场景' : 'When to use',
    invocation: zh ? '调用方式' : 'Invocation',
    model: zh ? '模型' : 'Model',
    user: zh ? '用户' : 'User',
    yes: zh ? '是' : 'yes',
    no: zh ? '否' : 'no',
    enabled: zh ? '已启用' : 'Enabled',
    disabled: zh ? '已停用' : 'Disabled',
    enable: zh ? '启用' : 'Enable',
    disable: zh ? '停用' : 'Disable',
    delete: zh ? '删除' : 'Delete',
    deleteConfirm: zh ? '确定删除这个 Skill？目录会被直接移除。' : 'Delete this skill and its directory?',
    prev: zh ? '上一页' : 'Previous',
    next: zh ? '下一页' : 'Next',
    pageSize: zh ? '每页' : 'Per page',
    total: zh ? '共 {count} 项' : '{count} items',
    pageOf: zh ? '第 {page} / {pages} 页' : 'Page {page} / {pages}',
    importTitle: zh ? '导入 Skill' : 'Import skill',
    inspect: zh ? '正在校验…' : 'Validating…',
    valid: zh ? '校验通过' : 'Valid',
    invalid: zh ? '校验未通过' : 'Invalid',
    files: zh ? '文件' : 'Files',
    noFiles: zh ? '只有 SKILL.md' : 'Only SKILL.md',
    confirm: zh ? '确认导入' : 'Import',
    cancel: zh ? '取消' : 'Cancel',
    close: zh ? '关闭' : 'Close',
    copy: zh ? '复制' : 'Copy',
    copied: zh ? '已复制' : 'Copied',
    codeTitle: zh ? '代码' : 'Code',
    wrap: zh ? '自动换行' : 'Wrap lines',
    unwrap: zh ? '取消换行' : 'Unwrap lines',
    footnotes: zh ? '脚注' : 'Footnotes',
    file: zh ? '文件' : 'File',
    directory: zh ? '目录' : 'Directory',
    binary: zh ? '二进制文件，无法预览' : 'Binary file, preview unavailable',
    chooseFile: zh ? '选择文件' : 'Choose file',
    uploadHint: zh ? '支持 SKILL.md 或包含 SKILL.md/脚本/资源的 zip' : 'SKILL.md or a zip containing SKILL.md, scripts and assets',
    retry: zh ? '重试' : 'Retry',
    builtin: zh ? '内置' : 'built-in',
    toolCount: zh ? '个工具' : 'tools',
  }
}

export function installCatalogStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-harness-catalog'
  tag.textContent = styles
  document.head.append(tag)
  return () => tag.remove()
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' })
  const body = await response.json() as { detail?: unknown }
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`)
  return body as T
}

async function sendJson<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { detail?: unknown }
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `HTTP ${response.status}`)
  return payload as T
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isZip(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
}

function SkillsPage(props: { locale: LocaleFace }) {
  const copy = copyOf(props.locale.getSnapshot().active)
  const [skills, setSkills] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState<File>()
  const [inspection, setInspection] = useState<Inspection>()
  const [inspectBusy, setInspectBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [browse, setBrowse] = useState('')

  useEffect(() => {
    let stopped = false
    setLoading(true)
    getJson<{ skills: Skill[] }>('/console-api/harness-catalog/skills')
      .then(body => { if (!stopped) { setSkills(body.skills); setError('') } })
      .catch(cause => { if (!stopped) setError(messageOf(cause)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [reload])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return skills.filter(skill => text === '' || `${skill.name} ${skill.description} ${skill.source} ${skill.provider}`.toLowerCase().includes(text))
  }, [skills, query])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  const inspect = async (file: File): Promise<void> => {
    setPending(file)
    setInspection(undefined)
    setImportError('')
    setInspectBusy(true)
    try {
      const zip = isZip(file)
      const response = await fetch('/console-api/harness-catalog/skills/inspect', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': zip ? 'application/zip' : 'application/json' },
        body: zip ? await file.arrayBuffer() : JSON.stringify({ content: await file.text() }),
      })
      setInspection(await response.json() as Inspection)
    } catch (cause) {
      setInspection({ valid: false, error: messageOf(cause) })
    } finally {
      setInspectBusy(false)
    }
  }

  const confirmImport = async (): Promise<void> => {
    if (pending === undefined || inspection?.valid !== true) return
    setImporting(true)
    setImportError('')
    try {
      const zip = isZip(pending)
      const response = await fetch('/console-api/harness-catalog/skills/import', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': zip ? 'application/zip' : 'application/json' },
        body: zip ? await pending.arrayBuffer() : JSON.stringify({ content: await pending.text() }),
      })
      const body = await response.json() as { detail?: unknown }
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`)
      setPending(undefined)
      setInspection(undefined)
      setReload(value => value + 1)
    } catch (cause) {
      setImportError(messageOf(cause))
    } finally {
      setImporting(false)
    }
  }

  const toggle = async (skill: Skill): Promise<void> => {
    try {
      await sendJson('/console-api/harness-catalog/skills/state', { name: skill.name, enabled: !skill.enabled })
      setReload(value => value + 1)
    } catch (cause) { setError(messageOf(cause)) }
  }

  const remove = async (skill: Skill): Promise<void> => {
    if (!window.confirm(copy.deleteConfirm)) return
    try {
      await sendJson(`/console-api/harness-catalog/skills/remove?name=${encodeURIComponent(skill.name)}`, {}, 'DELETE')
      if (browse === skill.name) setBrowse('')
      setReload(value => value + 1)
    } catch (cause) { setError(messageOf(cause)) }
  }

  return (
    <>
      <CatalogShell
        copy={copy}
        title={copy.skillsTitle}
        loading={loading}
        error={error}
        total={filtered.length}
        query={query}
        onQuery={setQuery}
        pageSize={pageSize}
        onPageSize={setPageSize}
        page={current}
        pages={pages}
        onPage={setPage}
        columns={[copy.name, copy.description, copy.status, copy.actions]}
        rows={visible.map(skill => ({
          key: skill.name,
          onActivate: () => setBrowse(skill.name),
          cells: [
            <span key="name"><strong>{skill.name}</strong><br /><span className="smp-catalog-source">{skill.provider}</span></span>,
            skill.description,
            <span key="status" className={skill.enabled ? 'pill succeeded' : 'pill offline'}>{skill.enabled ? copy.enabled : copy.disabled}</span>,
            <span key="actions" className="smp-catalog-actions" onClick={event => event.stopPropagation()}>
              {skill.editable && <>
                <button type="button" className="link" onClick={() => { void toggle(skill) }}>{skill.enabled ? copy.disable : copy.enable}</button>
                <button type="button" className="link danger" onClick={() => { void remove(skill) }}>{copy.delete}</button>
              </>}
            </span>,
          ],
        }))}
        empty={filtered.length === 0 ? (query === '' ? copy.empty : copy.noMatch) : ''}
        extra={<>
          <label className="smp-catalog-file" title={copy.uploadHint}>
            <span className="primary">{copy.import}</span>
            <input type="file" accept=".md,.markdown,.zip,application/zip,application/x-zip-compressed,text/markdown" onChange={event => { const file = event.target.files?.[0]; if (file !== undefined) void inspect(file); event.target.value = '' }} />
          </label>
          <input className="search" type="search" aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => setQuery(event.target.value)} />
        </>}
      />
      {pending !== undefined && <ImportDialog copy={copy} file={pending} inspection={inspection} busy={inspectBusy || importing} error={importError} onClose={() => { setPending(undefined); setInspection(undefined) }} onConfirm={() => { void confirmImport() }} />}
      {browse !== '' && <SkillBrowser name={browse} copy={copy} onClose={() => setBrowse('')} />}
    </>
  )
}

function ToolsPage(props: { locale: LocaleFace }) {
  const copy = copyOf(props.locale.getSnapshot().active)
  const [tools, setTools] = useState<Tool[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false
    setLoading(true)
    getJson<{ tools: Tool[] }>('/console-api/harness-catalog/tools')
      .then(body => { if (!stopped) { setTools(body.tools); setError('') } })
      .catch(cause => { if (!stopped) setError(messageOf(cause)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return tools.filter(tool => text === '' || `${tool.name} ${tool.description} ${tool.provider} ${tool.providerPackage}`.toLowerCase().includes(text))
  }, [tools, query])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  return (
    <CatalogShell
      copy={copy}
      title={copy.toolsTitle}
      loading={loading}
      error={error}
      total={filtered.length}
      query={query}
      onQuery={setQuery}
      pageSize={pageSize}
      onPageSize={setPageSize}
      page={current}
      pages={pages}
      onPage={setPage}
      columns={[copy.name, copy.description, copy.provider]}
      rows={visible.map(tool => ({
        key: tool.name,
        open: open === tool.name,
        onToggle: () => setOpen(value => value === tool.name ? '' : tool.name),
        cells: [
          <code key="name">{tool.name}</code>,
          tool.description,
          <span key="provider" className="smp-catalog-provider"><strong>{tool.provider}</strong>{tool.providerPackage !== '' && <code>{tool.providerPackage}</code>}</span>,
        ],
        detail: (
          <dl className="smp-catalog-detail">
            <dt>{copy.provider}</dt><dd>{tool.provider}{tool.providerPackage === '' ? '' : ` · ${tool.providerPackage}`}</dd>
            <dt>{copy.description}</dt><dd>{tool.description}</dd>
          </dl>
        ),
      }))}
      empty={filtered.length === 0 ? (query === '' ? copy.empty : copy.noMatch) : ''}
      extra={<span className="smp-catalog-source">{tools.length} {copy.toolCount}</span>}
    />
  )
}

interface CatalogRow {
  key: string
  onActivate?(): void
  open?: boolean
  onToggle?(): void
  cells: ReactNode[]
  detail?: ReactNode
}

function CatalogShell(props: {
  copy: ReturnType<typeof copyOf>
  title: string
  loading: boolean
  error: string
  total: number
  query: string
  onQuery(value: string): void
  pageSize: number
  onPageSize(value: number): void
  page: number
  pages: number
  onPage(value: number): void
  columns: string[]
  rows: CatalogRow[]
  empty: string
  extra?: ReactNode
}) {
  const copy = props.copy
  return (
    <Panel
      className="smp-list-panel smp-catalog-panel"
      title={props.title}
      extra={<div className="smp-catalog-toolbar">{props.extra}</div>}
    >
      {props.error !== '' && <p className="banner error">{props.error}</p>}
      {props.loading ? <p className="muted">{copy.loading}</p> : props.empty !== '' ? <p className="empty">{props.empty}</p> : (
        <div className="table-wrap smp-list-scroll">
          <table className="smp-catalog-table smp-table">
            <thead><tr>{props.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {props.rows.map(row => <CatalogRowView key={row.key} row={row} />)}
            </tbody>
          </table>
        </div>
      )}
      {props.total > 0 && (
        <div className="smp-catalog-pager smp-list-pager">
          <span className="muted">{copy.total.replace('{count}', String(props.total))}</span>
          <div className="row">
            <label>{copy.pageSize}<select value={props.pageSize} onChange={event => props.onPageSize(Number(event.target.value))}>{PAGE_SIZE.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
            <button type="button" className="secondary" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>{copy.prev}</button>
            <span>{copy.pageOf.replace('{page}', String(props.page)).replace('{pages}', String(props.pages))}</span>
            <button type="button" className="secondary" disabled={props.page >= props.pages} onClick={() => props.onPage(props.page + 1)}>{copy.next}</button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function CatalogRowView(props: { row: CatalogRow }) {
  const row = props.row
  const activate = row.onActivate ?? row.onToggle
  return (
    <>
      <tr
        className={`smp-catalog-row${row.open ? ' is-open' : ''}`}
        role={activate === undefined ? undefined : 'button'}
        tabIndex={activate === undefined ? undefined : 0}
        onClick={activate}
        onKeyDown={event => {
          if (activate === undefined || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          activate()
        }}
      >
        {row.cells.map((cell, index) => <td key={index}>{cell}</td>)}
      </tr>
      {row.open === true && row.detail !== undefined && <tr><td className="detail" colSpan={row.cells.length}>{row.detail}</td></tr>}
    </>
  )
}

function ImportDialog(props: {
  copy: ReturnType<typeof copyOf>
  file: File
  inspection?: Inspection
  busy: boolean
  error: string
  onClose(): void
  onConfirm(): void
}) {
  const copy = props.copy
  const valid = props.inspection?.valid === true
  return (
    <div className="smp-catalog-modal" onMouseDown={event => { if (event.target === event.currentTarget && !props.busy) props.onClose() }}>
      <section className="smp-catalog-modal-card" role="dialog" aria-modal="true" aria-label={copy.importTitle}>
        <header><h2>{copy.importTitle}</h2><button type="button" className="link" onClick={props.onClose} disabled={props.busy}>{copy.close}</button></header>
        <dl className="smp-catalog-detail">
          <dt>{copy.file}</dt><dd>{props.file.name}</dd>
          {props.inspection?.path !== undefined && <><dt>{copy.path}</dt><dd className="mono">{props.inspection.path}</dd></>}
          {props.inspection?.name !== undefined && <><dt>{copy.name}</dt><dd>{props.inspection.name}</dd></>}
          {props.inspection?.description !== undefined && <><dt>{copy.description}</dt><dd>{props.inspection.description}</dd></>}
          {props.inspection?.whenToUse !== undefined && props.inspection.whenToUse !== '' && <><dt>{copy.when}</dt><dd>{props.inspection.whenToUse}</dd></>}
        </dl>
        {props.inspection === undefined ? <p className="smp-catalog-import-status">{copy.inspect}</p> : (
          <p className={valid ? 'banner success' : 'banner error'}>{valid ? copy.valid : `${copy.invalid}: ${props.inspection.error ?? ''}`}</p>
        )}
        {valid && (
          <>
            <h3 className="smp-catalog-modal-subtitle">{copy.files}</h3>
            {props.inspection?.files === undefined || props.inspection.files.length === 0
              ? <p className="muted">{copy.noFiles}</p>
              : <ul className="smp-catalog-file-list">{props.inspection.files.map(file => <li key={file.path}><span className="mono">{file.path}</span><span>{file.size} B{file.executable ? ' · exec' : ''}</span></li>)}</ul>}
          </>
        )}
        {props.error !== '' && <p className="banner error">{copy.importFailed}: {props.error}</p>}
        <footer>
          <button type="button" className="secondary" onClick={props.onClose} disabled={props.busy}>{copy.cancel}</button>
          <button type="button" className="primary" onClick={props.onConfirm} disabled={!valid || props.busy}>{copy.confirm}</button>
        </footer>
      </section>
    </div>
  )
}

function PreviewBody(props: { copy: ReturnType<typeof copyOf>; preview: FilePreview }) {
  const copy = props.copy
  const path = props.preview.path
  const lower = path.toLowerCase()
  const markdown = lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')
  const lang = languageForPath(path) ?? ''
  const code = lang !== '' && !markdown
  if (markdown) {
    return (
      <div className="smp-catalog-markdown">
        <MarkdownText
          text={props.preview.content}
          labels={{
            code: { copyLabel: copy.copy, copiedLabel: copy.copied, toolbarLabels: { codeLabel: copy.codeTitle, wrapLabel: copy.wrap, unwrapLabel: copy.unwrap } },
            footnotes: copy.footnotes,
          }}
        />
      </div>
    )
  }
  if (code) {
    return (
      <CodeBlock
        code={props.preview.content}
        lang={lang}
        copyLabel={copy.copy}
        copiedLabel={copy.copied}
        toolbarLabels={{ codeLabel: copy.codeTitle, wrapLabel: copy.wrap, unwrapLabel: copy.unwrap }}
      />
    )
  }
  return <pre>{props.preview.content}</pre>
}

function SkillBrowser(props: { name: string; copy: ReturnType<typeof copyOf>; onClose(): void }) {
  const copy = props.copy
  const [nodes, setNodes] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<string[]>([])
  const [preview, setPreview] = useState<FilePreview>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')

  const load = async (path: string): Promise<void> => {
    setLoading(path)
    setError('')
    try {
      const body = await getJson<{ entries: FileEntry[] }>(`/console-api/harness-catalog/skills/files?name=${encodeURIComponent(props.name)}&path=${encodeURIComponent(path)}`)
      setNodes(current => ({ ...current, [path]: body.entries }))
    } catch (cause) { setError(messageOf(cause)) } finally { setLoading('') }
  }

  useEffect(() => { void load('') }, [props.name])

  const toggle = (path: string): void => {
    setExpanded(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path])
    if (nodes[path] === undefined) void load(path)
  }

  const open = async (entry: FileEntry): Promise<void> => {
    if (entry.type === 'directory') { toggle(entry.path); return }
    setLoading(entry.path)
    setError('')
    try {
      setPreview(await getJson<FilePreview>(`/console-api/harness-catalog/skills/file?name=${encodeURIComponent(props.name)}&path=${encodeURIComponent(entry.path)}`))
    } catch (cause) { setError(messageOf(cause)) } finally { setLoading('') }
  }

  const render = (path: string, depth: number): ReactNode => (
    <div key={path}>
      {(nodes[path] ?? []).map(entry => (
        <div key={entry.path}>
          <button type="button" className={`smp-catalog-tree-row${preview?.path === entry.path ? ' is-current' : ''}`} style={{ paddingLeft: `${8 + depth * 14}px` }} onClick={() => { void open(entry) }}>
            <span className="smp-catalog-tree-icon">
              {entry.type === 'directory'
                ? (expanded.includes(entry.path) ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />)
                : <FileTypeIcon kind={classifyFileType(entry.name)} />}
            </span>
            <span>{entry.name}</span>
          </button>
          {entry.type === 'directory' && expanded.includes(entry.path) && render(entry.path, depth + 1)}
        </div>
      ))}
    </div>
  )

  return (
    <div className="smp-catalog-drawer-mask" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
      <aside className="smp-catalog-drawer" role="dialog" aria-modal="true" aria-label={props.name}>
        <header><strong>{props.name}</strong><button type="button" className="link" onClick={props.onClose}>{copy.close}</button></header>
        <div className="smp-catalog-drawer-body">
          <nav className="smp-catalog-tree">
            <div className="smp-catalog-tree-root">{props.name}</div>
            {nodes[''] === undefined && loading === '' ? <p className="muted">{copy.loading}</p> : render('', 0)}
            {error !== '' && <p className="banner error">{error}</p>}
          </nav>
          <section className="smp-catalog-preview">
            {preview === undefined ? <p className="muted">{copy.file}</p> : (
              <>
                <div className="smp-catalog-preview-head"><span className="mono">{preview.path}</span><span>{preview.size} B</span></div>
                {preview.binary ? <p className="muted">{copy.binary}</p> : <PreviewBody copy={copy} preview={preview} />}
              </>
            )}
            {loading !== '' && <p className="smp-catalog-import-status">{copy.loading}</p>}
          </section>
        </div>
      </aside>
    </div>
  )
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientCtx): void {
  ctx.effect(installCatalogStyle)
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: SKILLS_PAGE,
    label: pageLabel(() => copyOf(ctx.locale.getSnapshot().active).skills, 'box'),
    order: 2, inject: () => ({ locale: ctx.locale }),
  }, SkillsPage))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: TOOLS_PAGE,
    label: pageLabel(() => copyOf(ctx.locale.getSnapshot().active).tools, 'server'),
    order: 3, inject: () => ({ locale: ctx.locale }),
  }, ToolsPage))
}
