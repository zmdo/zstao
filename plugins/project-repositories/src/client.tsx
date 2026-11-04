import { useEffect, useMemo, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { pageLabel } from './page-label.ts'
import styles from './pages/project-repositories.css'

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

interface PageProps {
  locale: LocaleFace
  openConsole?: (key: string) => void
}

interface Project {
  id: number
  name: string
  path: string
  description: string
  codeManagement: boolean
  issueManagement: boolean
  packManagement: boolean
  webUrl: string
  createDate: string
}

interface Settings {
  baseUrl: string
  username: string
  configured: boolean
  updatedAt: string | null
}

const CODE_PAGE = 'project-code-repositories'
const IMAGE_PAGE = 'project-image-registry'
const PIPELINE_PAGE = 'project-pipelines'
const SETTINGS_PAGE = 'project-management'
const GROUP = 'project-repositories'
const API = '/console-api/project-management'

function copyOf(active: string) {
  const zh = active !== 'en'
  return {
    group: zh ? '项目仓库管理' : 'Project repositories',
    code: zh ? '项目代码仓库' : 'Code repositories',
    image: zh ? '项目镜像仓库' : 'Image registry',
    pipeline: zh ? '部署流水线' : 'Deploy pipelines',
    settings: zh ? '项目管理' : 'Project management',
    settingsTitle: zh ? '项目管理' : 'Project management',
    name: zh ? '项目' : 'Project',
    oneDev: zh ? 'OneDev 代码仓库' : 'OneDev repository',
    baseUrl: zh ? 'OneDev 地址' : 'OneDev URL',
    username: zh ? '用户名' : 'Username',
    password: zh ? '密码' : 'Password',
    passwordHint: zh ? '留空表示沿用已保存的密码。' : 'Leave blank to keep the saved password.',
    save: zh ? '保存配置' : 'Save',
    test: zh ? '测试连接' : 'Test connection',
    saved: zh ? '配置已保存' : 'Saved',
    saveFailed: zh ? '保存失败' : 'Could not save',
    testOk: zh ? '连接成功' : 'Connected',
    projectCount: zh ? '个项目' : 'projects',
    configured: zh ? '已配置' : 'Configured',
    notConfigured: zh ? '未配置' : 'Not configured',
    security: zh ? '密码会使用 CES 加密密钥保存，不会回传到浏览器。建议使用内网地址。' : 'The password is encrypted with the CES key and never returned to the browser. Prefer an internal address.',
    projects: zh ? '项目代码仓库' : 'Code repositories',
    refresh: zh ? '刷新' : 'Refresh',
    search: zh ? '搜索项目' : 'Search projects',
    loading: zh ? '正在读取…' : 'Loading…',
    empty: zh ? 'OneDev 中还没有项目' : 'No projects in OneDev yet',
    noMatch: zh ? '没有匹配项目' : 'No matching projects',
    open: zh ? '打开 OneDev' : 'Open OneDev',
    path: zh ? '路径' : 'Path',
    description: zh ? '说明' : 'Description',
    permissions: zh ? '能力' : 'Capabilities',
    codeOn: zh ? '代码' : 'Code',
    issueOn: zh ? 'Issue' : 'Issue',
    packOn: zh ? '包' : 'Packages',
    goSettings: zh ? '打开项目管理' : 'Open project management',
    refreshHint: zh ? '数据来自 OneDev REST API。' : 'Data comes from the OneDev REST API.',
    imageHint: zh ? '项目镜像仓库尚未接入，后续完成设计后再开放。' : 'The project image registry is not connected yet.',
    pipelineHint: zh ? '部署流水线尚未接入，后续完成设计后再开放。' : 'Deploy pipelines are not connected yet.',
    retry: zh ? '重试' : 'Retry',
  }
}

export function installStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-project-repositories'
  tag.textContent = styles
  document.head.append(tag)
  return () => tag.remove()
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { credentials: 'same-origin', ...init })
  const body = await response.json() as { detail?: unknown }
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`)
  return body as T
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function ProjectSettingsPage(props: PageProps) {
  const copy = copyOf(props.locale.getSnapshot().active)
  const [settings, setSettings] = useState<Settings>({ baseUrl: 'http://10.2.8.9', username: 'admin', configured: false, updatedAt: null })
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false
    json<Settings>('/settings')
      .then(value => { if (!stopped) setSettings(value) })
      .catch(cause => { if (!stopped) setError(messageOf(cause)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const next = await json<Settings>('/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl: settings.baseUrl, username: settings.username, password }),
      })
      setSettings(next)
      setPassword('')
      setNotice(copy.saved)
    } catch (cause) { setError(messageOf(cause)) } finally { setSaving(false) }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setNotice('')
    setError('')
    try {
      const result = await json<{ projectCount: number }>('/test', { method: 'POST' })
      setNotice(`${copy.testOk} · ${result.projectCount} ${copy.projectCount}`)
    } catch (cause) { setError(messageOf(cause)) } finally { setTesting(false) }
  }

  return (
    <Panel className="smp-project-panel" title={copy.settingsTitle}>
      <p className="smp-project-muted">{copy.security}</p>
      <div className="smp-project-form">
        <label><span>{copy.baseUrl}</span><input value={settings.baseUrl} disabled={loading || saving} onChange={event => setSettings({ ...settings, baseUrl: event.target.value })} /></label>
        <label><span>{copy.username}</span><input value={settings.username} disabled={loading || saving} onChange={event => setSettings({ ...settings, username: event.target.value })} /></label>
        <label><span>{copy.password}</span><input type="password" value={password} placeholder={settings.configured ? '••••••••' : ''} disabled={loading || saving} onChange={event => setPassword(event.target.value)} /><small>{copy.passwordHint}</small></label>
      </div>
      <p className={settings.configured ? 'smp-project-status ok' : 'smp-project-status'}>{settings.configured ? `${copy.configured} · ${settings.username}` : copy.notConfigured}</p>
      <div className="smp-project-actions">
        <button type="button" className="primary" disabled={loading || saving} onClick={() => { void save() }}>{copy.save}</button>
        <button type="button" className="secondary" disabled={loading || saving || testing} onClick={() => { void test() }}>{copy.test}</button>
      </div>
      {notice !== '' && <p className="smp-project-notice ok">{notice}</p>}
      {error !== '' && <p className="smp-project-notice error">{copy.saveFailed}: {error}</p>}
    </Panel>
  )
}

function CodeRepositoriesPage(props: PageProps) {
  const copy = copyOf(props.locale.getSnapshot().active)
  const [projects, setProjects] = useState<Project[]>([])
  const [baseUrl, setBaseUrl] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let stopped = false
    setLoading(true)
    json<{ baseUrl: string; projects: Project[] }>('/projects')
      .then(body => { if (!stopped) { setProjects(body.projects); setBaseUrl(body.baseUrl); setError('') } })
      .catch(cause => { if (!stopped) setError(messageOf(cause)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [reload])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return projects.filter(project => text === '' || `${project.name} ${project.path} ${project.description}`.toLowerCase().includes(text))
  }, [projects, query])

  return (
    <Panel
      className="smp-project-panel"
      title={copy.projects}
      extra={<div className="smp-project-toolbar"><input type="search" aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => setQuery(event.target.value)} /><button type="button" className="secondary" disabled={loading} onClick={() => setReload(value => value + 1)}>{copy.refresh}</button></div>}
    >
      {error !== '' && <p className="smp-project-notice error">{error} <button type="button" className="link" onClick={() => setReload(value => value + 1)}>{copy.retry}</button></p>}
      {loading ? <p className="smp-project-muted">{copy.loading}</p> : filtered.length === 0 ? <p className="smp-project-muted">{query === '' ? copy.empty : copy.noMatch}</p> : (
        <div className="table-wrap">
          <table className="smp-table smp-project-table">
            <thead><tr><th>{copy.name}</th><th>{copy.path}</th><th>{copy.description}</th><th>{copy.permissions}</th><th /></tr></thead>
            <tbody>{filtered.map(project => (
              <tr key={project.id}>
                <td><strong>{project.name}</strong></td>
                <td className="mono">{project.path}</td>
                <td>{project.description}</td>
                <td className="smp-project-caps">
                  {project.codeManagement && <span>{copy.codeOn}</span>}
                  {project.issueManagement && <span>{copy.issueOn}</span>}
                  {project.packManagement && <span>{copy.packOn}</span>}
                </td>
                <td><a className="link" href={project.webUrl} target="_blank" rel="noreferrer">{copy.open}</a></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="smp-project-muted">{baseUrl === '' ? copy.refreshHint : `${copy.refreshHint} ${baseUrl}`}</p>
    </Panel>
  )
}

function PlaceholderPage(props: PageProps & { title: string; hint: string }) {
  return (
    <Panel className="smp-project-panel" title={props.title}>
      <p className="smp-project-muted">{props.hint}</p>
    </Panel>
  )
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientCtx): void {
  ctx.effect(installStyle)
  const zh = () => ctx.locale.getSnapshot().active !== 'en'
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: CODE_PAGE,
    label: pageLabel(() => zh() ? '项目代码仓库' : 'Code repositories', { group: GROUP, groupLabel: zh() ? '项目仓库管理' : 'Project repositories', navigation: 'sidebar', icon: 'server' }),
    order: 4,
    inject: () => ({ locale: ctx.locale }),
  }, CodeRepositoriesPage))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: IMAGE_PAGE,
    label: pageLabel(() => zh() ? '项目镜像仓库' : 'Image registry', { group: GROUP, groupLabel: zh() ? '项目仓库管理' : 'Project repositories', navigation: 'sidebar', icon: 'server' }),
    order: 5,
    inject: () => ({ locale: ctx.locale }),
  }, (props: PageProps) => <PlaceholderPage {...props} title={zh() ? '项目镜像仓库' : 'Image registry'} hint={zh() ? '项目镜像仓库尚未接入，后续完成设计后再开放。' : 'The project image registry is not connected yet.'} />))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: PIPELINE_PAGE,
    label: pageLabel(() => zh() ? '部署流水线' : 'Deploy pipelines', { group: GROUP, groupLabel: zh() ? '项目仓库管理' : 'Project repositories', navigation: 'sidebar', icon: 'server' }),
    order: 6,
    inject: () => ({ locale: ctx.locale }),
  }, (props: PageProps) => <PlaceholderPage {...props} title={zh() ? '部署流水线' : 'Deploy pipelines'} hint={zh() ? '部署流水线尚未接入，后续完成设计后再开放。' : 'Deploy pipelines are not connected yet.'} />))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: SETTINGS_PAGE,
    label: pageLabel(() => zh() ? '项目管理' : 'Project management', { group: 'platform', groupLabel: zh() ? '平台设置' : 'Platform settings', placement: 'footer', icon: 'settings' }),
    order: 9,
    inject: () => ({ locale: ctx.locale }),
  }, ProjectSettingsPage))
}
