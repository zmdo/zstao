import { useEffect, useState } from 'react'
import { Panel } from '@smp/console-kit'
import type { PullCredential } from './contracts.ts'
import { errorText, json, RequestError } from './client-api.ts'

interface Binding { server_identity: string; desired_revision: string; applied_revision: string | null; state: string; active: boolean; last_error: string | null; last_pull_result?: { pulled?: boolean; error?: string } | null }
interface Client { id: string; name: string; server_ids: string[]; repositories: string[] }
interface Target { id: string; name: string; host: string }
const API = '/console-api/application-registry'
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + path, { credentials: 'same-origin', ...init })
  const value = await response.json()
  if (!response.ok) throw new RequestError(value.error ?? 'request_failed')
  return value
}
const post = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
export function PullCredentialSettings({ zh }: { zh: boolean }): JSX.Element {
  const [value, setValue] = useState<PullCredential>()
  const [repositories, setRepositories] = useState('')
  const [password, setPassword] = useState('')
  const [bindings, setBindings] = useState<Binding[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('OneDev')
  const [clientScopes, setClientScopes] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const refresh = async () => {
    const [b, c, t] = await Promise.all([api<{ bindings: Binding[] }>('/bindings'), api<{ clients: Client[] }>('/clients'), api<{ targets: Target[] }>('/targets')])
    setBindings(b.bindings); setClients(c.clients); setTargets(t.targets)
  }
  const load = async () => {
    const next = await json<PullCredential>('/image-registry/pull-credentials')
    setValue(next); setRepositories(next.repositories.join('\n'))
  }
  useEffect(() => { let stopped = false
    const update = async () => { try { if (!stopped) await refresh() } catch (cause) { if (!stopped) setError(errorText(cause, zh)) } }
    void load().catch(cause => setError(errorText(cause, zh))); void update()
    const timer = setInterval(() => { void update() }, 15_000)
    return () => { stopped = true; clearInterval(timer) }
  }, [zh])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (cause) { setError(errorText(cause, zh)) } finally { setBusy(false) }
  }
  const save = (enabled: boolean) => run(async () => {
    if (!value) return
    const next = await json<PullCredential>('/image-registry/pull-credentials', post({ expectedRevision: value.revision, registry: value.registry, username: value.username, repositories: repositories.split(/\s+/).filter(Boolean), password, enabled }))
    setValue(next); setPassword(''); setMessage(zh ? '已保存。已关联服务器将在后台同步；发布前会再次检查。' : 'Saved. Associated servers will synchronize; deployment checks again.')
    await refresh()
  })
  const states: Record<string, string> = zh ? { pending: '待同步', synced: '已同步', failed: '同步失败', cleanup_pending: '待清理', removed: '已清理', orphaned: '服务器已删除，远端清理未确认' } : {}
  const failure = (code: string | null | undefined): string => {
    const errors: Record<string, [string, string]> = {
      registry_login_failed: ['Registry 登录失败，请检查拉取账号和密码', 'Registry login failed; check the pull credentials'],
      registry_auth_failed: ['认证失败，请更新平台拉取密码', 'Authentication failed; update the platform pull password'],
      registry_permission_denied: ['账号没有该镜像的拉取权限', 'The account cannot pull this image'],
      image_pull_failed: ['镜像拉取失败，请检查镜像地址和网络', 'Image pull failed; check the image and network'],
      deployment_outcome_unknown: ['发布结果未知，需核对服务器后再操作', 'Deployment outcome is unknown; inspect the server before retrying'],
    }
    return code ? errors[code]?.[zh ? 0 : 1] ?? (zh ? '操作未完成，请查看服务器任务' : 'Operation incomplete; inspect the server task') : ''
  }
  return <Panel className="smp-project-panel" title={zh ? '应用服务器拉取凭据' : 'Application server pull credentials'}>
    <p className="smp-project-muted">{zh ? '请使用在 TCR 中限制为只读拉取的专用账号。首次受管拉取时配置服务器，后续按版本复用；此配置与 API 密钥、构建推送凭据独立。' : 'Use a dedicated TCR account restricted to pulling. Servers receive credentials on first managed pull and reuse the current revision. API and build credentials remain separate.'}</p>
    {value && <><p>{zh ? '凭据状态' : 'Credential status'}：{value.configured ? (zh ? '完整' : 'Complete') : (zh ? '待配置或已停用' : 'Incomplete or disabled')} · v{value.revision}</p>
      <div className="smp-project-form">
        <label><span>Registry</span><input value={value.registry} onChange={event => setValue({ ...value, registry: event.target.value })} /></label>
        <label><span>{zh ? '拉取账号' : 'Pull username'}</span><input autoComplete="off" value={value.username} onChange={event => setValue({ ...value, username: event.target.value })} /></label>
        <label><span>{zh ? '拉取密码' : 'Pull password'}</span><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder={zh ? '留空保持原密码' : 'Leave blank to keep saved password'} /></label>
        <label><span>{zh ? '允许的仓库（每行一个）' : 'Allowed repositories (one per line)'}</span><textarea value={repositories} onChange={event => setRepositories(event.target.value)} placeholder={'namespace/repository\nnamespace/*'} /></label>
      </div>
      <div className="smp-project-actions"><button disabled={busy} onClick={() => { void save(true) }}>{zh ? '保存拉取凭据' : 'Save pull credentials'}</button><button disabled={busy || !value.enabled} onClick={() => { void save(false) }}>{zh ? '停用并清理服务器配置' : 'Disable and clean server configurations'}</button><button disabled={busy} onClick={() => { void run(load) }}>{zh ? '重新读取' : 'Reload'}</button></div>
    </>}
    <p>{zh ? '同步仅代表凭据配置完成，具体镜像能否拉取由部署结果确认。停用仅删除平台配置，不会撤销腾讯云账号权限。' : 'Synchronization confirms credential configuration; the deployment result confirms an image pull. Disabling removes platform copies, without revoking the cloud account.'}</p>
    <table><thead><tr><th>{zh ? '服务器' : 'Server'}</th><th>{zh ? '实际 / 期望版本' : 'Applied / desired'}</th><th>{zh ? '同步状态' : 'Sync status'}</th><th>{zh ? '最近拉取' : 'Last pull'}</th><th /></tr></thead><tbody>{bindings.map(binding => <tr key={binding.server_identity}><td>{targets.find(t => t.id === binding.server_identity)?.name ?? binding.server_identity}</td><td>{binding.applied_revision ?? '—'} / {binding.desired_revision}</td><td>{states[binding.state] ?? binding.state}{binding.last_error && <small> · {failure(binding.last_error)}</small>}</td><td>{binding.last_pull_result ? binding.last_pull_result.error === 'deployment_outcome_unknown' ? (zh ? '结果待核对' : 'Outcome unknown') : binding.last_pull_result.pulled ? (zh ? '成功' : 'Succeeded') : (zh ? '失败' : 'Failed') : '—'}{binding.last_pull_result?.error && <small> · {failure(binding.last_pull_result.error)}</small>}</td><td><button disabled={busy || binding.state === 'orphaned'} onClick={() => { void run(async () => { await api(`/bindings/${binding.server_identity}`, post({ active: !binding.active })); await refresh() }) }}>{binding.active ? (zh ? '解除关联并清理' : 'Unlink and clean') : (zh ? '恢复关联' : 'Restore association')}</button></td></tr>)}</tbody></table>
    <h3>{zh ? '发布调用凭证' : 'Deployment service credentials'}</h3>
    <p>{zh ? '仅允许指定服务器和仓库的凭据准备及部署。生成后将调用凭证保存到 OneDev 的秘密配置中。' : 'Only prepares credentials and deploys to selected servers and repositories. Store the generated token in OneDev secrets.'}</p>
    <div className="smp-project-form"><label><span>{zh ? '名称' : 'Name'}</span><input value={name} onChange={event => setName(event.target.value)} /></label><label><span>{zh ? '目标服务器' : 'Target servers'}</span><select multiple value={selected} onChange={event => setSelected([...event.target.selectedOptions].map(option => option.value))}>{targets.map(t => <option key={t.id} value={t.id}>{t.name} ({t.host})</option>)}</select></label><label><span>{zh ? '允许的完整仓库范围' : 'Allowed full repository scopes'}</span><textarea value={clientScopes} onChange={event => setClientScopes(event.target.value)} placeholder="ccr.ccs.tencentyun.com/namespace/*" /></label></div>
    <button disabled={busy || !selected.length || !clientScopes} onClick={() => { void run(async () => { const next = await api<{ token: string }>('/clients', post({ name, serverIds: selected, repositories: clientScopes.split(/\s+/).filter(Boolean) })); setToken(next.token); await refresh() }) }}>{zh ? '生成调用凭证' : 'Create service token'}</button>
    {token && <div><p>{zh ? '只显示本次，请妥善保存：' : 'Shown once. Save securely:'}</p><input readOnly type="password" value={token} autoComplete="off" /><button onClick={() => { void navigator.clipboard.writeText(token).catch(() => setError(zh ? '复制失败' : 'Copy failed')) }}>{zh ? '复制' : 'Copy'}</button><button onClick={() => setToken('')}>{zh ? '已保存，隐藏' : 'Saved; hide'}</button></div>}
    <ul>{clients.map(client => <li key={client.id}>{client.name} · {client.repositories.join(', ')} <button disabled={busy} onClick={() => { void run(async () => { await api(`/clients/${client.id}`, { method: 'DELETE' }); await refresh() }) }}>{zh ? '撤销调用凭证' : 'Revoke service token'}</button></li>)}</ul>
    {message && <p className="smp-project-notice ok">{message}</p>}{error && <p role="alert" className="smp-project-notice error">{error}</p>}
  </Panel>
}
