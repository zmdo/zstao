import { useState, useSyncExternalStore, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { Panel } from '@smp/console-kit'
import { shellCopy } from './copy.ts'
import type { LocaleFace } from './general-view.tsx'

interface AuthSnap {
  username: string | null
  totpEnabled: boolean
}

interface AuthStore {
  get(): AuthSnap
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
}

async function post(path: string, fallback: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as { detail?: unknown }
  if (!response.ok) {
    throw new Error(typeof payload.detail === 'string' ? payload.detail : fallback)
  }
  return payload as Record<string, unknown>
}

/** Login security, registered by the shell itself. */
export function SecurityView(props: { auth: AuthStore; locale: LocaleFace }) {
  const auth = useSyncExternalStore(props.auth.subscribe, props.auth.get)
  const copy = useSyncExternalStore(
    listener => props.locale.subscribe(listener),
    () => shellCopy(props.locale.getSnapshot().active),
  )
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const savedName = auth.username ?? ''
  const [username, setUsername] = useState(savedName)
  const [seenName, setSeenName] = useState(savedName)
  const [busy, setBusy] = useState(false)
  if (seenName !== savedName) {
    const previous = seenName
    setSeenName(savedName)
    if (username === previous) setUsername(savedName)
  }
  const usernameDirty = username !== savedName
  const passwordDirty = currentPassword !== '' || newPassword !== ''

  async function run(action: () => Promise<string>): Promise<void> {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      setMessage(await action())
      await props.auth.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.requestFailed)
    } finally {
      setBusy(false)
    }
  }

  function saveUsername(event: FormEvent): void {
    event.preventDefault()
    if (!usernameDirty || busy) return
    void run(async () => {
      await post('/console-api/auth/username', copy.requestFailed, { username })
      return copy.usernameSaved
    })
  }

  function beginSetup(): void {
    void run(async () => {
      const created = await post('/console-api/auth/totp/setup', copy.requestFailed)
      const secret = String(created.secret ?? '')
      const otpauthUri = String(created.otpauth_uri ?? '')
      setQrDataUrl(await QRCode.toDataURL(otpauthUri, { margin: 1, width: 196 }))
      setSetup({ secret, otpauth_uri: otpauthUri })
      return ''
    })
  }

  function confirmSetup(event: FormEvent): void {
    event.preventDefault()
    void run(async () => {
      await post('/console-api/auth/totp/confirm', copy.requestFailed, { code: confirmCode })
      setSetup(null)
      setQrDataUrl('')
      setConfirmCode('')
      return copy.totpEnabled
    })
  }

  function disable(event: FormEvent): void {
    event.preventDefault()
    void run(async () => {
      await post('/console-api/auth/totp/disable', copy.requestFailed, { password: disablePassword, code: disableCode })
      setDisablePassword('')
      setDisableCode('')
      return copy.totpDisabled
    })
  }

  function changePassword(event: FormEvent): void {
    event.preventDefault()
    if (!passwordDirty || busy) return
    void run(async () => {
      await post('/console-api/auth/password', copy.requestFailed, { current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
      return copy.passwordSaved
    })
  }

  return (
    <>
      {error !== '' && <p className="banner error">{error}</p>}
      {message !== '' && <p className="banner ok">{message}</p>}
      <Panel title={copy.security}>
          <form className="panel-form" onSubmit={saveUsername}>
            <label>{copy.username}<input value={username} autoComplete="username" required onChange={event => { setUsername(event.target.value); setMessage('') }} /></label>
            <button className="primary" type="submit" disabled={!usernameDirty || busy}>{copy.saveUsername}</button>
          </form>
          <p>{copy.totp}：<strong>{auth.totpEnabled ? copy.totpOn : copy.totpOff}</strong></p>
          {!auth.totpEnabled ? (
            setup === null ? (
              <button className="primary" type="button" disabled={busy} onClick={beginSetup}>{copy.enableTotp}</button>
            ) : (
              <form className="panel-form" onSubmit={confirmSetup}>
                <p className="muted">{copy.totpHelp}</p>
                <img className="qr" src={qrDataUrl} width={196} height={196} alt={copy.totpQr} />
                <p className="mono">{setup.secret}</p>
                <label>{copy.code}<input value={confirmCode} inputMode="numeric" maxLength={6} required onChange={event => setConfirmCode(event.target.value)} /></label>
                <div className="row">
                  <button className="primary" type="submit" disabled={busy}>{copy.confirmEnable}</button>
                  <button className="link" type="button" onClick={() => { setSetup(null); setQrDataUrl('') }}>{copy.cancel}</button>
                </div>
              </form>
            )
          ) : (
            <form className="panel-form" onSubmit={disable}>
              <label>{copy.password}<input value={disablePassword} type="password" autoComplete="current-password" required onChange={event => setDisablePassword(event.target.value)} /></label>
              <label>{copy.code}<input value={disableCode} inputMode="numeric" maxLength={6} required onChange={event => setDisableCode(event.target.value)} /></label>
              <button className="primary" type="submit" disabled={busy}>{copy.disableTotp}</button>
            </form>
          )}
      </Panel>
      <Panel title={copy.changePassword}>
          <form className="panel-form" onSubmit={changePassword}>
            <label>{copy.currentPassword}<input value={currentPassword} type="password" autoComplete="current-password" required onChange={event => { setCurrentPassword(event.target.value); setMessage('') }} /></label>
            <label>{copy.newPassword}<input value={newPassword} type="password" autoComplete="new-password" required onChange={event => { setNewPassword(event.target.value); setMessage('') }} /></label>
            <button className="primary" type="submit" disabled={!passwordDirty || busy}>{copy.save}</button>
          </form>
      </Panel>
    </>
  )
}
