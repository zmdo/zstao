import { useEffect, useState, type FormEvent } from 'react'
import { Panel } from '@smp/console-kit'
import { dataCopy } from '../copy.ts'

interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

const PAGE_STYLE = `
.smp-console .smp-data-field { display: grid; gap: 6px; }
.smp-console .smp-data-key { display: flex; gap: 8px; }
.smp-console .smp-data-key > input { flex: 1; min-width: 0; }
`

export function installDataStyle(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@smp/console-encryption-key'
  tag.textContent = PAGE_STYLE
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

export function DataPage(props: { locale: LocaleFace }) {
  const [active, setActive] = useState(props.locale.getSnapshot().active)
  const copy = dataCopy(active)
  const [key, setKey] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => props.locale.subscribe(() => setActive(props.locale.getSnapshot().active)), [props.locale])

  useEffect(() => {
    let stopped = false
    void fetch('/console-api/data/key', { credentials: 'include' })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { encryptionKey?: unknown; detail?: unknown }
        if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.loadFailed)
        if (typeof payload.encryptionKey !== 'string') throw new Error(copy.loadFailed)
        if (!stopped) {
          const loaded = payload.encryptionKey
          setSavedKey(loaded)
          setKey(current => current === '' ? loaded : current)
        }
      })
      .catch(caught => {
        if (!stopped) setError(caught instanceof Error ? caught.message : copy.loadFailed)
      })
    return () => { stopped = true }
  }, [copy.loadFailed])

  function generate(): void {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    let text = ''
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
    setKey(btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
    setError('')
    setMessage('')
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    if (key === savedKey || busy) return
    setError('')
    setMessage('')
    setBusy(true)
    void fetch('/console-api/data/key', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ encryptionKey: key }),
    }).then(async response => {
      const payload = await response.json().catch(() => ({})) as { detail?: unknown }
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.saveFailed)
      setSavedKey(key)
      setMessage(copy.saved)
    }).catch(caught => {
      setError(caught instanceof Error ? caught.message : copy.saveFailed)
    }).finally(() => {
      setBusy(false)
    })
  }

  return (
    <>
      {error !== '' && <p className="banner error">{error}</p>}
      {message !== '' && <p className="banner ok">{message}</p>}
      <Panel title={copy.title}>
        <form className="panel-form" onSubmit={save}>
          <div className="smp-data-field">
            <label htmlFor="encryptionKey">{copy.key}</label>
            <span className="smp-data-key">
              <input id="encryptionKey" type={visible ? 'text' : 'password'} value={key} autoComplete="off" spellCheck={false} required onChange={event => { setKey(event.target.value); setMessage('') }} />
              <button className="secondary" type="button" onClick={() => setVisible(current => !current)}>{visible ? copy.hide : copy.show}</button>
              <button className="secondary" type="button" onClick={generate}>{copy.generate}</button>
            </span>
          </div>
          <p className="muted">{copy.warning}</p>
          <button className="primary" type="submit" disabled={key === savedKey || busy}>{copy.save}</button>
        </form>
      </Panel>
    </>
  )
}
