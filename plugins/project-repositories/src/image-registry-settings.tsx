import { PullCredentialSettings } from './pull-credential-settings.tsx'
import { useEffect, useState } from 'react'
import { Panel } from '@smp/console-kit'
import { errorText, json, useLanguage } from './client-api.ts'

interface LocaleFace { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
interface Props { locale: LocaleFace }
interface RegistrySettings { registry: string; namespace: string; username: string; configured: boolean; secretId: string; secretKey: string; password: string; updatedAt: string | null }

export function ImageRegistrySettings(props: Props): JSX.Element {
  const zh = useLanguage(props.locale)
  const [registry, setRegistry] = useState('ccr.ccs.tencentyun.com')
  const [namespace, setNamespace] = useState('')
  const [username, setUsername] = useState('')
  const [secretId, setSecretId] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [password, setPassword] = useState('')
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false
    json<RegistrySettings>('/image-registry/settings')
      .then(value => { if (stopped) return; setRegistry(value.registry); setNamespace(value.namespace); setUsername(value.username); setConfigured(value.configured) })
      .catch(cause => { if (!stopped) setError(errorText(cause, zh)) })
      .finally(() => { if (!stopped) setLoading(false) })
    return () => { stopped = true }
  }, [zh])

  const body = (): string => JSON.stringify({ registry, namespace, username, secretId, secretKey, password })
  const save = async (): Promise<void> => {
    setSaving(true); setNotice(''); setError('')
    try {
      const next = await json<RegistrySettings>('/image-registry/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body() })
      setConfigured(next.configured); setSecretId(''); setSecretKey(''); setPassword('')
      setNotice(zh ? '镜像仓库配置已保存' : 'Registry settings saved')
    } catch (cause) { setError(errorText(cause, zh)) } finally { setSaving(false) }
  }
  const test = async (): Promise<void> => {
    setTesting(true); setNotice(''); setError('')
    try {
      const result = await json<{ repositoryCount: number }>('/image-registry/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body() })
      setNotice(zh ? `连接成功，发现 ${result.repositoryCount} 个仓库` : `Connected; ${result.repositoryCount} repositories`)
    } catch (cause) { setError(errorText(cause, zh)) } finally { setTesting(false) }
  }

  return (
    <><Panel className="smp-project-panel smp-image-settings-panel" title={zh ? '项目镜像仓库' : 'Project image registry'}>
      <p className="smp-project-muted">{zh ? '用于项目镜像仓库页面。SecretId/SecretKey 调用 TCR API，已有用户名/密码保留为构建侧凭据，不自动分发到服务器。' : 'Used by the project image registry page. SecretId/SecretKey call the TCR API; legacy username/password remain build credentials and are not distributed.'}</p>
      {loading && <p className="muted">{zh ? '正在读取…' : 'Loading…'}</p>}
      {!loading && <div className="smp-project-form">
        <label><span>Registry</span><input value={registry} disabled={saving} onChange={event => setRegistry(event.target.value)} placeholder="ccr.ccs.tencentyun.com" /></label>
        <label><span>{zh ? '命名空间' : 'Namespace'}</span><input value={namespace} disabled={saving} onChange={event => setNamespace(event.target.value)} placeholder="zstao" /></label>
        <label><span>SecretId</span><input value={secretId} disabled={saving} onChange={event => setSecretId(event.target.value)} placeholder={configured ? (zh ? '已保存，留空保持不变' : 'Saved; leave blank to keep') : 'AKID...'} autoComplete="off" /></label>
        <label><span>SecretKey</span><input type="password" value={secretKey} disabled={saving} onChange={event => setSecretKey(event.target.value)} placeholder={configured ? (zh ? '已保存，留空保持不变' : 'Saved; leave blank to keep') : ''} autoComplete="new-password" /></label>
        <label><span>{zh ? 'Registry 用户名' : 'Registry username'}</span><input value={username} disabled={saving} onChange={event => setUsername(event.target.value)} autoComplete="off" /></label>
        <label><span>{zh ? 'Registry 密码' : 'Registry password'}</span><input type="password" value={password} disabled={saving} onChange={event => setPassword(event.target.value)} placeholder={configured ? (zh ? '已保存，留空保持不变' : 'Saved; leave blank to keep') : ''} autoComplete="new-password" /></label>
      </div>}
      <div className="smp-project-actions">
        <button type="button" className="primary" disabled={loading || saving} onClick={() => { void save() }}>{zh ? '保存镜像仓库' : 'Save registry'}</button>
        <button type="button" className="secondary" disabled={loading || testing} onClick={() => { void test() }}>{zh ? '测试 TCR API' : 'Test TCR API'}</button>
      </div>
      <p className={configured ? 'smp-project-status ok' : 'smp-project-status'}>{configured ? (zh ? 'TCR API 已配置' : 'TCR API configured') : (zh ? 'TCR API 未配置' : 'TCR API not configured')}</p>
      {notice !== '' && <p className="smp-project-notice ok">{notice}</p>}
      {error !== '' && <p className="smp-project-notice error">{error}</p>}
    </Panel><PullCredentialSettings zh={zh} /></>
  )
}
