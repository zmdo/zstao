import { useEffect, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { pageLabel } from './page-label.ts'
import styles from './pages/project-repositories.css'
import { CodeRepositoriesPage } from './repository-browser.tsx'
import { PipelinesPage } from './pipelines.tsx'
import { ImageRegistryPage } from './image-registry.tsx'
import { ImageRegistrySettings } from './image-registry-settings.tsx'
import { SavedPassword } from './password-view.tsx'
import { errorText, json, useLanguage } from './client-api.ts'

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

interface AiIdentity { username: string; email: string; publicKey: string; privateKeyPath: string }

interface Settings {
  internalBaseUrl: string
  externalBaseUrl: string
  username: string
  configured: boolean
  updatedAt: string | null
}

const CODE_PAGE = 'project-code-repositories'
const IMAGE_PAGE = 'project-image-registry'
const PIPELINE_PAGE = 'project-pipelines'
const SETTINGS_PAGE = 'project-management'
const GROUP = 'project-repositories'

function copyOf(active: string) {
  const zh = active !== 'en'
  return {
    group: zh ? '项目仓库管理' : 'Project repositories',
    code: zh ? '项目代码仓库' : 'Code repositories',
    image: zh ? '项目镜像仓库' : 'Image registry',
    pipeline: zh ? '部署流水线' : 'Deploy pipelines',
    settings: zh ? '项目管理' : 'Project management',
    settingsTitle: zh ? '项目管理' : 'Project management',
    aiIdentity: zh ? 'AI Git 身份' : 'AI Git identity',
    aiUsername: zh ? '用户名' : 'Username',
    aiEmail: zh ? '邮箱' : 'Email',
    aiPublicKey: zh ? 'SSH 公钥' : 'SSH public key',
    aiPrivateKey: zh ? '私钥路径' : 'Private key path',
    aiReadOnly: zh ? '以上身份信息只读，由系统预置。' : 'These identity values are provisioned and read-only.',
    name: zh ? '项目' : 'Project',
    oneDev: zh ? 'OneDev 代码仓库' : 'OneDev repository',
    internalUrl: zh ? '内部访问地址' : 'Internal URL',
    externalUrl: zh ? '外部访问地址' : 'External URL',
    externalHint: zh ? '留空时与内部访问地址相同。打开 OneDev 会优先使用外部地址。' : 'Defaults to the internal URL. Open OneDev uses this URL when set.',
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
    security: zh ? '密码使用 CES 加密密钥保存，仅在主动显示或复制时返回浏览器。' : 'The saved password is encrypted and returned only when you choose Show or Copy.',
    projects: zh ? '项目代码仓库' : 'Code repositories',
    refresh: zh ? '刷新' : 'Refresh',
    search: zh ? '搜索项目' : 'Search projects',
    loading: zh ? '正在读取…' : 'Loading…',
    empty: zh ? 'OneDev 中还没有项目' : 'No projects in OneDev yet',
    noMatch: zh ? '没有匹配项目' : 'No matching projects',
    open: zh ? '从 OneDev 浏览' : 'Browse in OneDev',
    updated: zh ? '最近更新' : 'Last updated',
    prev: zh ? '上一页' : 'Previous',
    next: zh ? '下一页' : 'Next',
    pageOf: zh ? '第 {page} / {pages} 页' : 'Page {page} / {pages}',
    pageSize: zh ? '每页' : 'Per page',
    total: zh ? '共 {count} 项' : '{count} items',
    loadMore: zh ? '加载更多' : 'Load more',
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

function ProjectSettingsPage(props: PageProps) {
  const zh = useLanguage(props.locale)
  const copy = copyOf(zh ? 'zh' : 'en')
  const [settings, setSettings] = useState<Settings>({ internalBaseUrl: 'http://10.2.8.9', externalBaseUrl: 'http://10.2.8.9', username: 'admin', configured: false, updatedAt: null })
  const [ai, setAi] = useState<AiIdentity>()
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
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setLoading(false) })
    json<AiIdentity>('/settings/ai-identity')
      .then(value => { if (!stopped) setAi(value) })
      .catch(cause => { void cause })
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
        body: JSON.stringify({ internalBaseUrl: settings.internalBaseUrl, externalBaseUrl: settings.externalBaseUrl, username: settings.username, password }),
      })
      setSettings(next)
      setPassword('')
      setNotice(copy.saved)
    } catch (cause) { setError(errorText(cause, zh)) } finally { setSaving(false) }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setNotice('')
    setError('')
    try {
      const result = await json<{ projectCount: number }>('/test', { method: 'POST' })
      setNotice(`${copy.testOk} · ${result.projectCount} ${copy.projectCount}`)
    } catch (cause) { setError(errorText(cause, zh)) } finally { setTesting(false) }
  }

  return (
    <>
    <Panel className="smp-project-panel" title={copy.settingsTitle}>
      <p className="smp-project-muted">{copy.security}</p>
      <div className="smp-project-form">
        <label><span>{copy.internalUrl}</span><input value={settings.internalBaseUrl} disabled={loading || saving} onChange={event => setSettings({ ...settings, internalBaseUrl: event.target.value })} /></label>
        <label><span>{copy.externalUrl}</span><input value={settings.externalBaseUrl} disabled={loading || saving} onChange={event => setSettings({ ...settings, externalBaseUrl: event.target.value })} /><small>{copy.externalHint}</small></label>
        <label><span>{copy.username}</span><input value={settings.username} disabled={loading || saving} onChange={event => setSettings({ ...settings, username: event.target.value })} /></label>
        <label><span>{settings.configured ? (zh ? '新密码' : 'New password') : copy.password}</span><input type="password" autoComplete="new-password" value={password} disabled={loading || saving} onChange={event => setPassword(event.target.value)} /><small>{copy.passwordHint}</small></label>
      </div>
      {settings.configured && !saving && <SavedPassword key={settings.updatedAt} zh={zh} />}
      <p className={settings.configured ? 'smp-project-status ok' : 'smp-project-status'}>{settings.configured ? `${copy.configured} · ${settings.username}` : copy.notConfigured}</p>
      <div className="smp-project-actions">
        <button type="button" className="primary" disabled={loading || saving} onClick={() => { void save() }}>{copy.save}</button>
        <button type="button" className="secondary" disabled={loading || saving || testing} onClick={() => { void test() }}>{copy.test}</button>
      </div>
      {notice !== '' && <p className="smp-project-notice ok">{notice}</p>}
      {error !== '' && <p className="smp-project-notice error">{copy.saveFailed}: {error}</p>}
    </Panel>
    {ai && <Panel className="smp-repo-ai-panel" title={copy.aiIdentity}>
      <dl className="smp-repo-ai-identity"><dt>{copy.aiUsername}</dt><dd><code>{ai.username}</code></dd><dt>{copy.aiEmail}</dt><dd><code>{ai.email}</code></dd><dt>{copy.aiPublicKey}</dt><dd><code className="smp-repo-public-key">{ai.publicKey}</code></dd><dt>{copy.aiPrivateKey}</dt><dd><code>{ai.privateKeyPath}</code></dd></dl>
      <small>{copy.aiReadOnly}</small>
    </Panel>}
    <ImageRegistrySettings locale={props.locale} />
    </>
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
  const projectGroup = () => zh() ? '项目仓库管理' : 'Project repositories'
  const platformGroup = () => zh() ? '平台设置' : 'Platform settings'
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: CODE_PAGE,
    label: pageLabel(() => zh() ? '项目代码仓库' : 'Code repositories', { group: GROUP, groupLabel: projectGroup, navigation: 'sidebar', icon: 'code' }),
    order: 4,
    inject: () => ({ locale: ctx.locale }),
  }, CodeRepositoriesPage))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: IMAGE_PAGE,
    label: pageLabel(() => zh() ? '项目镜像仓库' : 'Image registry', { group: GROUP, groupLabel: projectGroup, navigation: 'sidebar', icon: 'code' }),
    order: 5,
    inject: () => ({ locale: ctx.locale }),
  }, ImageRegistryPage))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: PIPELINE_PAGE,
    label: pageLabel(() => zh() ? '部署流水线' : 'Deploy pipelines', { group: GROUP, groupLabel: projectGroup, navigation: 'sidebar', icon: 'code' }),
    order: 6,
    inject: () => ({ locale: ctx.locale }),
  }, PipelinesPage))
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page', key: SETTINGS_PAGE,
    label: pageLabel(() => zh() ? '项目管理' : 'Project management', { group: 'platform', groupLabel: platformGroup, placement: 'footer', icon: 'settings' }),
    order: 9,
    inject: () => ({ locale: ctx.locale }),
  }, ProjectSettingsPage))
}
