import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Panel } from '@smp/console-kit'
import { shellCopy } from './copy.ts'
import { landingChoice, landingLabel, landingPages, type SidebarMode } from './landing.ts'
import type { LandingStore } from './landing-store.ts'
import { navGroups, pageRoutes, type RegisteredPage } from './pages.ts'
import { DEFAULT_TITLE, siteDraft } from './site.ts'
import { DEFAULT_ICON_DARK, DEFAULT_ICON_LIGHT } from './site-mark.ts'
import type { SiteStore } from './site-chrome.ts'

interface LocaleChoice {
  id: string
  label: string
}

export interface LocaleFace {
  getSnapshot(): { active: string; locales: readonly LocaleChoice[] }
  subscribe(listener: () => void): () => void
  setLocale(id: string): void
}

export interface ThemeFace {
  getTheme(): { preference: string }
  setTheme(id: string): void
  subscribe(listener: () => void): () => void
}

interface PageSlots {
  entries(name: string): readonly RegisteredPage[]
  subscribe(name: string, listener: () => void): () => void
}

export function GeneralView(props: { slots: PageSlots; locale: LocaleFace; theme: ThemeFace; site: SiteStore; landing: LandingStore }) {
  const locale = useSyncExternalStore(listener => props.locale.subscribe(listener), () => props.locale.getSnapshot())
  const theme = useSyncExternalStore(listener => props.theme.subscribe(listener), () => props.theme.getTheme())
  const copy = shellCopy(locale.active)
  const themes = [
    { id: 'light', label: copy.light },
    { id: 'dark', label: copy.dark },
    { id: 'system', label: copy.system },
  ]
  return (
    <>
      <SitePanel copy={copy} site={props.site} slots={props.slots} landing={props.landing} />
      <Panel title={copy.language}>
        <div className="choice-row">
          {locale.locales.map(choice => (
            <button
              key={choice.id}
              className={choice.id === locale.active ? 'primary' : 'secondary'}
              type="button"
              aria-pressed={choice.id === locale.active}
              onClick={() => props.locale.setLocale(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={copy.appearance}>
        <div className="choice-row">
          {themes.map(choice => (
            <button
              key={choice.id}
              className={choice.id === theme.preference ? 'primary' : 'secondary'}
              type="button"
              aria-pressed={choice.id === theme.preference}
              onClick={() => props.theme.setTheme(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </Panel>
    </>
  )
}

function SitePanel(props: { copy: ReturnType<typeof shellCopy>; site: SiteStore; slots: PageSlots; landing: LandingStore }) {
  const { copy } = props
  const site = useSyncExternalStore(props.site.subscribe, props.site.get)
  const entries = useSyncExternalStore(listener => props.slots.subscribe('console.page', listener), () => props.slots.entries('console.page'))
  const chrome = useSyncExternalStore(props.landing.subscribe, props.landing.get)
  const destinations = landingPages(navGroups(pageRoutes(entries)))
  const storedPage = landingChoice(chrome.page, destinations)
  const baseline = { title: site.title, icon: site.icon, page: storedPage, sidebar: chrome.sidebar }
  const [title, setTitle] = useState(baseline.title)
  const [icon, setIcon] = useState(baseline.icon)
  const [page, setPage] = useState(baseline.page)
  const [sidebar, setSidebar] = useState<SidebarMode>(baseline.sidebar)
  const [seen, setSeen] = useState(baseline)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (seen.title !== baseline.title || seen.icon !== baseline.icon || seen.page !== baseline.page || seen.sidebar !== baseline.sidebar) {
    const previous = seen
    setSeen(baseline)
    if (title === previous.title) setTitle(baseline.title)
    if (icon === previous.icon) setIcon(baseline.icon)
    if (page === previous.page) setPage(baseline.page)
    if (sidebar === previous.sidebar) setSidebar(baseline.sidebar)
  }

  const dirty = title !== baseline.title || icon !== baseline.icon || page !== baseline.page || sidebar !== baseline.sidebar

  function onIcon(event: { target: HTMLInputElement }): void {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (file === undefined) return
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      const draft = siteDraft({ title, icon: value })
      if (!draft.ok) {
        setError(draft.error === 'title' ? copy.titleInvalid : copy.iconInvalid)
        return
      }
      setIcon(draft.icon)
      setError('')
      setMessage('')
    }
    reader.readAsDataURL(file)
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    if (!dirty || busy) return
    const draft = siteDraft({ title, icon })
    if (!draft.ok) {
      setError(draft.error === 'title' ? copy.titleInvalid : copy.iconInvalid)
      setMessage('')
      return
    }
    const siteChanged = draft.title !== baseline.title || draft.icon !== baseline.icon
    const entryChanged = page !== baseline.page || sidebar !== baseline.sidebar
    setBusy(true)
    setError('')
    setMessage('')
    void (async () => {
      if (siteChanged) {
        const response = await fetch('/console-api/site', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: draft.title, icon: draft.icon }),
        })
        const payload = await response.json().catch(() => ({})) as { detail?: unknown; title?: unknown; icon?: unknown }
        if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.requestFailed)
        const nextTitle = typeof payload.title === 'string' && payload.title !== '' ? payload.title : DEFAULT_TITLE
        const nextIcon = typeof payload.icon === 'string' ? payload.icon : ''
        setTitle(nextTitle)
        setIcon(nextIcon)
        props.site.apply(nextTitle, nextIcon)
      }
      if (entryChanged) {
        const response = await fetch('/console-api/landing', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ page, sidebar }),
        })
        const payload = await response.json().catch(() => ({})) as { detail?: unknown }
        if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.requestFailed)
        props.landing.apply(page)
        props.landing.applySidebar(sidebar)
      }
      setMessage(copy.siteSaved)
    })().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : copy.requestFailed)
    }).finally(() => { setBusy(false) })
  }

  return (
    <Panel title={copy.site}>
      {error !== '' && <p className="banner error">{error}</p>}
      {message !== '' && <p className="banner ok">{message}</p>}
      <form className="panel-form" onSubmit={save}>
        <label>
          {copy.siteTitle}
          <input aria-label={copy.siteTitle} value={title} maxLength={80} onChange={event => { setTitle(event.target.value); setMessage('') }} />
        </label>
        <div className="site-icon-field">
          <span>{copy.siteIcon}</span>
          <button type="button" className="site-icon" aria-label={copy.siteIcon} onClick={() => fileRef.current?.click()}>
            {icon === '' ? (
              <>
                <img className="mark-light" src={DEFAULT_ICON_LIGHT} alt="" width={100} height={100} />
                <img className="mark-dark" src={DEFAULT_ICON_DARK} alt="" width={100} height={100} />
              </>
            ) : (
              <img src={icon} alt="" width={100} height={100} />
            )}
          </button>
          <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onIcon} />
          <p className="row">
            <span className="muted">{copy.siteIconHint}</span>
            {icon !== '' && (
              <button className="secondary" type="button" onClick={() => { setIcon(''); setMessage(''); setError('') }}>
                {copy.siteIconDefault}
              </button>
            )}
          </p>
        </div>
        <label>
          {copy.landing}
          <select aria-label={copy.landing} value={page} onChange={event => { setPage(event.target.value); setMessage('') }}>
            {destinations.map(item => (
              <option key={item.key} value={item.key}>{landingLabel(item, destinations)}</option>
            ))}
          </select>
        </label>
        <label>
          {copy.sidebar}
          <select aria-label={copy.sidebar} value={sidebar} onChange={event => { setSidebar(event.target.value === 'expanded' ? 'expanded' : 'collapsed'); setMessage('') }}>
            <option value="collapsed">{copy.sidebarCollapsed}</option>
            <option value="expanded">{copy.sidebarExpanded}</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={!dirty || busy}>{copy.save}</button>
      </form>
    </Panel>
  )
}
