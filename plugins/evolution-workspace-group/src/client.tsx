import { useEffect, useState } from 'react'

interface Remote {
  role: 'onedev' | 'backup'
  name: string
  url: string
  username: string
  authType: string
  pushMode: string
  enabled: boolean
  hasSecret?: boolean
  secret?: string
  passphrase?: string
}

interface Config {
  enabled: boolean
  workdir: string
  remotes: Remote[]
}

const API = '/console-api/evolution-dev/git'

const STYLE = `
.evolution-git-card{border:1px solid var(--line);border-radius:4px;padding:14px 16px;margin:12px 0;background:var(--dsw-alias-bg-layer-2)}
.evolution-git-card h3{margin:0 0 10px;font-size:14px}
.evolution-git-row{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 12px;align-items:center;margin:8px 0}
.evolution-git-row label{color:var(--muted);font-size:13px}
.evolution-git-row input,.evolution-git-row select{min-width:0;padding:6px 8px;border:1px solid var(--line);border-radius:4px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.evolution-git-actions{display:flex;gap:8px;align-items:center;margin-top:10px}
.evolution-git-actions button{padding:6px 12px;border-radius:4px;border:1px solid var(--line);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.evolution-git-actions button.primary{background:var(--primary);color:#fff;border-color:var(--primary)}
.evolution-git-status{font-size:12px;color:var(--muted);white-space:pre-wrap;word-break:break-word}
.evolution-git-error{color:var(--danger,#d33);font-size:12px;white-space:pre-wrap}
`

const empty = (role: 'onedev' | 'backup'): Remote => ({
  role,
  name: role === 'onedev' ? 'OneDev' : '备份',
  url: '',
  username: role === 'onedev' ? 'admin' : 'git',
  authType: 'https_token',
  pushMode: 'mirror',
  enabled: true,
})

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(API + path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

function Card({ remote, setRemote, test }: { remote: Remote; setRemote: (next: Remote) => void; test: () => void }) {
  const update = (key: keyof Remote, value: string | boolean) => setRemote({ ...remote, [key]: value } as Remote)
  return <section className="evolution-git-card">
    <h3>{remote.role === 'onedev' ? 'OneDev 仓库' : '异地备灾仓库'}</h3>
    <div className="evolution-git-row"><label>名称</label><input value={remote.name} onChange={e => update('name', e.target.value)} /></div>
    <div className="evolution-git-row"><label>地址</label><input value={remote.url} placeholder={remote.role === 'backup' ? 'git@backup.example.com:ces.git' : 'http://43.128.69.189/CES.git'} onChange={e => update('url', e.target.value)} /></div>
    <div className="evolution-git-row"><label>用户名</label><input value={remote.username} onChange={e => update('username', e.target.value)} /></div>
    <div className="evolution-git-row"><label>验证方式</label><select value={remote.authType} onChange={e => update('authType', e.target.value)}>
      <option value="https_token">HTTPS + Access Token</option>
      <option value="https_password">HTTPS + 密码</option>
      <option value="ssh_key">SSH 私钥</option>
      <option value="ssh_agent">SSH Agent</option>
    </select></div>
    <div className="evolution-git-row"><label>凭据</label><input type="password" value={remote.secret ?? ''} placeholder={remote.hasSecret ? '已配置，留空不修改' : (remote.authType === 'ssh_key' ? '粘贴私钥' : '粘贴 token/密码')} onChange={e => update('secret', e.target.value)} /></div>
    <div className="evolution-git-row"><label>推送模式</label><select value={remote.pushMode} onChange={e => update('pushMode', e.target.value)}>
      <option value="mirror">--mirror</option>
      <option value="all_tags">--all + --tags</option>
      <option value="branches">指定分支</option>
    </select></div>
    <div className="evolution-git-actions"><button type="button" onClick={test}>测试连接</button><span className="evolution-git-status">{remote.hasSecret ? '凭据已保存' : '尚未保存凭据'}</span></div>
  </section>
}

export function GitSettings() {
  const [config, setConfig] = useState<Config>({ enabled: true, workdir: '/root/.smp/evolution-dev/default-workspace', remotes: [empty('onedev'), empty('backup')] })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    request('/config').then((data: Config) => {
      const byRole = new Map(data.remotes.map(remote => [remote.role, remote]))
      setConfig({ ...data, remotes: [byRole.get('onedev') ?? empty('onedev'), byRole.get('backup') ?? empty('backup')] })
    }).catch(cause => setError(String(cause)))
  }, [])

  const updateRemote = (role: 'onedev' | 'backup', next: Remote) => {
    setConfig({ ...config, remotes: config.remotes.map(remote => remote.role === role ? next : remote) })
  }

  const save = async () => {
    setBusy(true); setError(''); setStatus('')
    try {
      const body = { ...config, remotes: config.remotes.map(({ secret, passphrase, hasSecret, ...remote }) => ({ ...remote, ...(secret ? { secret } : {}) })) }
      const saved = await request('/config', { method: 'PUT', body: JSON.stringify(body) })
      setConfig(saved)
      setStatus('已保存')
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const test = async (role: 'onedev' | 'backup') => {
    setBusy(true); setError(''); setStatus('')
    try {
      const result = await request('/test', { method: 'POST', body: JSON.stringify({ role }) })
      setStatus(result.ok ? `连接成功\n${result.output || ''}` : `连接失败\n${result.output || ''}`)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  return <div>
    <style>{STYLE}</style>
    <h2 style={{ margin: '0 0 6px' }}>演进开发</h2>
    <p style={{ color: 'var(--muted)', margin: '0 0 12px' }}>只对“演进开发”工作区组生效。凭据不会回显；留空表示保留原值。</p>
    <div className="evolution-git-row"><label>启用 Git 工具</label><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /></div>
    <div className="evolution-git-row"><label>工作目录</label><input value={config.workdir} onChange={e => setConfig({ ...config, workdir: e.target.value })} /></div>
    {config.remotes.map(remote => <Card key={remote.role} remote={remote} setRemote={next => updateRemote(remote.role, next)} test={() => void test(remote.role)} />)}
    <div className="evolution-git-actions"><button type="button" className="primary" disabled={busy} onClick={() => void save()}>保存</button>{status && <span className="evolution-git-status">{status}</span>}</div>
    {error && <div className="evolution-git-error">{error}</div>}
  </div>
}

export const inject = ['slots', 'locale']

export function apply(ctx: any): void {
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'evolution-dev',
    order: 30,
    label: '演进开发',
  }, GitSettings)))
}
