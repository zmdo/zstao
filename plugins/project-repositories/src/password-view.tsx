import { useEffect, useRef, useState } from 'react'
import { errorText, json, RequestError } from './client-api.ts'

export function SavedPassword(props: { zh: boolean }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hide = () => {
    request.current?.abort()
    clearTimeout(timer.current)
    setText('')
    setBusy(false)
    setNotice('')
  }
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) hide() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      request.current?.abort()
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  const reveal = async (copy: boolean) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const body = await json<{ password: string }>('/settings/reveal-password', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (copy) {
        if (!navigator.clipboard) throw new RequestError('clipboard_failed')
        try { await navigator.clipboard.writeText(body.password) } catch (cause) { void cause; throw new RequestError('clipboard_failed') }
        if (!controller.signal.aborted) setNotice(props.zh ? '已复制' : 'Copied')
      } else {
        setText(body.password)
        clearTimeout(timer.current)
        timer.current = setTimeout(hide, 30_000)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause, props.zh))
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="smp-repo-saved-password">
    <span>{props.zh ? '已保存密码' : 'Saved password'}</span>
    <output aria-live="polite" className="mono">{text || '••••••••'}</output>
    <button type="button" className="secondary" disabled={busy && !text} onClick={() => { if (text) hide(); else void reveal(false) }}>{text ? (props.zh ? '隐藏' : 'Hide') : (props.zh ? '显示' : 'Show')}</button>
    <button type="button" className="secondary" disabled={busy} onClick={() => { void reveal(true) }}>{props.zh ? '复制' : 'Copy'}</button>
    {notice && <span role="status">{notice}</span>}
    {error && <span role="alert">{error}</span>}
    {text && <small>{props.zh ? '30 秒后自动隐藏；剪贴板中的内容不会自动清除。' : 'Hides after 30 seconds. Copied text stays in the clipboard.'}</small>}
  </div>
}
