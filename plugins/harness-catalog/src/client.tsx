import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Panel } from '@smp/console-kit'
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
}

interface Tool {
  name: string
  description: string
  provider: string
  providerPackage: string
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
    skillName: zh ? '名称' : 'Name',
    description: zh ? '说明' : 'Description',
    source: zh ? '来源' : 'Source',
    provider: zh ? '提供插件' : 'Provided by',
    status: zh ? '状态' : 'Status',
    search: zh ? '搜索' : 'Search',
    loading: zh ? '正在读取…' : 'Loading…',
    empty: zh ? '还没有安装 Skill' : 'No skills installed',
    noMatch: zh ? '没有匹配项' : 'No matches',
    loadFailed: zh ? '读取失败' : 'Could not load',
    import: zh ? '导入 Skill' : 'Import skill',
    importHint: zh ? '选择 SKILL.md 或包含 SKILL.md/脚本的 zip；同名技能不会被覆盖。' : 'Choose a SKILL.md or a zip containing SKILL.md/scripts; existing skill names are not overwritten.',
    importOk: zh ? '已导入' : 'Imported',
    importFailed: zh ? '导入失败' : 'Import failed',
    chooseFile: zh ? '选择文件' : 'Choose file',
    path: zh ? '路径' : 'Path',
    when: zh ? '适用场景' : 'When to use',
    invocation: zh ? '调用方式' : 'Invocation',
    model: zh ? '模型' : 'Model',
    user: zh ? '用户' : 'User',
    yes: zh ? '是' : 'yes',
    no: zh ? '否' : 'no',
    prev: zh ? '上一页' : 'Previous',
    next: zh ? '下一页' : 'Next',
    pageSize: zh ? '每页' : 'Per page',
    total: zh ? '共 {count} 项' : '{count} items',
    pageOf: zh ? '第 {page} / {pages} 页' : 'Page {page} / {pages}',
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

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function SkillsPage(props: { locale: LocaleFace }) {
  const copy = copyOf(props.locale.getSnapshot().active)
  const [skills, setSkills] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [imported, setImported] = useState('')

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

  const importFile = async (file: File): Promise<void> => {
    setImporting(true)
    setImportError('')
    setImported('')
    try {
      const zip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
      const response = await fetch('/console-api/harness-catalog/skills/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': zip ? 'application/zip' : 'application/json' },
        body: zip ? await file.arrayBuffer() : JSON.stringify({ content: await file.text() }),
      })
      const body = await response.json() as { name?: string; detail?: unknown }
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`)
      setImported(body.name ?? '')
      setReload(value => value + 1)
    } catch (cause) {
      setImportError(messageOf(cause))
    } finally {
      setImporting(false)
    }
  }

  return (
    <CatalogShell
      copy={copy}
      title={copy.skillsTitle}
      loading={loading}
      error={error}
      filtered={filtered.length}
      query={query}
      onQuery={setQuery}
      pageSize={pageSize}
      onPageSize={setPageSize}
      page={current}
      pages={pages}
      onPage={setPage}
      columns={[copy.skillName, copy.description, copy.source]}
      rows={visible.map(skill => ({
        key: skill.name,
        open: open === skill.name,
        onToggle: () => setOpen(value => value === skill.name ? '' : skill.name),
        cells: [
          <span key="name"><strong>{skill.name}</strong><br /><span className="smp-catalog-source">{skill.provider}</span></span>,
          skill.description,
          <span key="source" className="smp-catalog-source">{skill.source}</span>,
        ],
        detail: (
          <dl className="smp-catalog-detail">
            <dt>{copy.path}</dt><dd className="mono">{skill.path || '—'}</dd>
            <dt>{copy.when}</dt><dd>{skill.whenToUse || '—'}</dd>
            <dt>{copy.invocation}</dt><dd>{copy.model}: {skill.modelInvocable ? copy.yes : copy.no} · {copy.user}: {skill.userInvocable ? copy.yes : copy.no}</dd>
          </dl>
        ),
      }))}
      empty={filtered.length === 0 ? (query === '' ? copy.empty : copy.noMatch) : ''}
      extra={
        <span className="smp-catalog-import">
          <label className="smp-catalog-file" title={copy.importHint}>
            <span className="secondary">{copy.import}</span>
            <input
              type="file"
              accept=".md,.markdown,.zip,application/zip,application/x-zip-compressed,text/markdown"
              disabled={importing}
              onChange={event => {
                const file = event.target.files?.[0]
                if (file !== undefined) void importFile(file)
                event.target.value = ''
              }}
            />
          </label>
          <span className="smp-catalog-import-status">{importing ? copy.loading : imported === '' ? copy.importHint : `${copy.importOk}: ${imported}`}</span>
          {importError !== '' && <span className="banner error">{copy.importFailed}: {importError}</span>}
        </span>
      }
    />
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
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let stopped = false
    setLoading(true)
    getJson<{ tools: Tool[] }>('/console-api/harness-catalog/tools')
      .then(body => { if (!stopped) { setTools(body.tools); setError('') } })
      .catch(cause => { if (!stopped) setError(messageOf(cause)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [reload])

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
      filtered={filtered.length}
      query={query}
      onQuery={setQuery}
      pageSize={pageSize}
      onPageSize={setPageSize}
      page={current}
      pages={pages}
      onPage={setPage}
      columns={[copy.skillName, copy.description, copy.provider]}
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

function CatalogShell(props: {
  copy: ReturnType<typeof copyOf>
  title: string
  loading: boolean
  error: string
  filtered: number
  query: string
  onQuery(value: string): void
  pageSize: number
  onPageSize(value: number): void
  page: number
  pages: number
  onPage(value: number): void
  columns: string[]
  rows: Array<{ key: string; open: boolean; onToggle(): void; cells: ReactNode[]; detail: ReactNode }>
  empty: string
  extra?: ReactNode
}) {
  const copy = props.copy
  return (
    <Panel
      className="smp-list-panel smp-catalog-panel"
      title={props.title}
      extra={<div className="smp-catalog-toolbar">{props.extra}<input className="search" type="search" aria-label={copy.search} placeholder={copy.search} value={props.query} onChange={event => props.onQuery(event.target.value)} /></div>}
    >
      {props.error !== '' && <p className="banner error">{props.error}</p>}
      {props.loading ? <p className="muted">{copy.loading}</p> : props.empty !== '' ? <p className="empty">{props.empty}</p> : (
        <div className="table-wrap smp-list-scroll">
          <table className="smp-catalog-table smp-table">
            <thead><tr>{props.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {props.rows.map(row => (
                <CatalogRow key={row.key} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.filtered > 0 && (
        <div className="smp-catalog-pager smp-list-pager">
          <span className="muted">{copy.total.replace('{count}', String(props.filtered))}</span>
          <div className="row">
            <label>{copy.pageSize}<select value={props.pageSize} onChange={event => props.onPageSize(Number(event.target.value))}>{PAGE_SIZE.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
            <button type="button" className="secondary" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>{copy.prev}</button>
            <span>{copy.pageOf.replace('{page}', String(props.page)).replace('{pages}', String(props.pages))}</span>
            <button type="button" className="secondary" disabled={props.page >= props.pages} onClick={() => props.onPage(props.page + 1)}>{copy.next}</button>
          </div>
        </div>
      )}
      {props.error !== '' && <p><button type="button" className="secondary" onClick={() => props.onPage(1)}>{copy.retry}</button></p>}
    </Panel>
  )
}

function CatalogRow(props: { row: { key: string; open: boolean; onToggle(): void; cells: ReactNode[]; detail: ReactNode } }) {
  return (
    <>
      <tr
        className={props.row.open ? 'smp-catalog-row is-open' : 'smp-catalog-row'}
        role="button"
        aria-expanded={props.row.open}
        tabIndex={0}
        onClick={props.row.onToggle}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.row.onToggle()
        }}
      >
        {props.row.cells.map((cell, index) => <td key={index}>{cell}</td>)}
      </tr>
      {props.row.open && <tr><td className="detail" colSpan={props.row.cells.length}>{props.row.detail}</td></tr>}
    </>
  )
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientCtx): void {
  ctx.effect(installCatalogStyle)
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: SKILLS_PAGE,
    label: pageLabel(() => copyOf(ctx.locale.getSnapshot().active).skills, 'box'),
    order: 2,
    inject: () => ({ locale: ctx.locale }),
  }, SkillsPage))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: TOOLS_PAGE,
    label: pageLabel(() => copyOf(ctx.locale.getSnapshot().active).tools, 'server'),
    order: 3,
    inject: () => ({ locale: ctx.locale }),
  }, ToolsPage))
}
