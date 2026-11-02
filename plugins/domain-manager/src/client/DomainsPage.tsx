import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { Dialog, DialogButton } from '@smp/console-kit/dialog'
import { ApiError, api, type LocaleFace } from './api.ts'
import { copyFor, type Copy } from './copy.ts'

interface DomainRow {
  id: string
  name: string
  zoneId: string
  accountId: string
  accountName: string
  status: string
  description: string
  createdAt: string
}

interface DnsRow {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied: boolean
  modifiedOn: string
  comment: string
}

interface Failure {
  code: string
  detail: string
}

function failureOf(cause: unknown): Failure {
  if (cause instanceof ApiError) return { code: cause.code, detail: cause.message }
  return { code: 'request_failed', detail: cause instanceof Error ? cause.message : String(cause) }
}

function messageOf(copy: Copy, failure: Failure): string {
  return copy.errors[failure.code] ?? failure.detail
}

function formatTime(iso: string, active: string): string {
  if (iso === '') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(active.startsWith('en') ? 'en-US' : 'zh-CN')
}

export function DomainsPage(props: { locale: LocaleFace }) {
  const active = useSyncExternalStore(
    (listener) => props.locale.subscribe(listener),
    () => props.locale.getSnapshot().active,
  )
  const copy = copyFor(active)
  const [domains, setDomains] = useState<DomainRow[] | null>(null)
  const [selected, setSelected] = useState('')
  const [records, setRecords] = useState<DnsRow[] | null>(null)
  const [loadingDomains, setLoadingDomains] = useState(true)
  const [loadingDns, setLoadingDns] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [reload, setReload] = useState(0)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<DomainRow | null>(null)
  const [removing, setRemoving] = useState<DomainRow | null>(null)

  const loadDomains = useCallback(async (prefer?: string) => {
    setLoadingDomains(true)
    setFailure(null)
    try {
      const data = await api<{ domains: DomainRow[] }>('/console-api/domains')
      setDomains(data.domains)
      setSelected((current) => {
        const wanted = prefer ?? current
        if (wanted !== '' && data.domains.some((row) => row.id === wanted)) return wanted
        return data.domains[0]?.id ?? ''
      })
    } catch (cause) {
      setFailure(failureOf(cause))
    } finally {
      setLoadingDomains(false)
    }
  }, [])

  useEffect(() => {
    void loadDomains()
  }, [loadDomains])

  useEffect(() => {
    if (selected === '') {
      setRecords(null)
      return
    }
    let cancelled = false
    setLoadingDns(true)
    setRecords(null)
    void api<{ records: DnsRow[] }>(`/console-api/domains/${selected}/dns`)
      .then((data) => {
        if (!cancelled) setRecords(data.records)
      })
      .catch((cause) => {
        if (!cancelled) setFailure(failureOf(cause))
      })
      .finally(() => {
        if (!cancelled) setLoadingDns(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, reload])

  const current = domains?.find((row) => row.id === selected)

  return (
    <div className="smp-domain-shell">
      <aside className="smp-domain-sidebar">
        <header className="smp-domain-head">
          <h2>{copy.domains}</h2>
          <button className="link" type="button" onClick={() => setAdding(true)}>
            {copy.add}
          </button>
        </header>
        <nav className="smp-domain-list" aria-label={copy.domains}>
          {domains?.map((domain) => (
            <div className={`smp-domain-row${domain.id === selected ? ' is-on' : ''}`} key={domain.id}>
              <button
                className="smp-domain-item"
                type="button"
                aria-current={domain.id === selected ? 'true' : undefined}
                onClick={() => {
                  setFailure(null)
                  setSelected(domain.id)
                }}
                title={domain.name}
              >
                <span className="smp-domain-name">{domain.name}</span>
                <span className={`smp-domain-desc${domain.description === '' ? ' is-empty' : ''}`}>
                  {domain.description === '' ? copy.noDescription : domain.description}
                </span>
              </button>
              <div className="smp-domain-item-actions">
                <button
                  className="smp-domain-icon-button"
                  type="button"
                  aria-label={`${copy.edit} ${domain.name}`}
                  title={copy.edit}
                  onClick={(event) => {
                    event.stopPropagation()
                    setEditing(domain)
                  }}
                >
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                    <path d="M10.5 2.8 13.2 5.5 6 12.7l-3.2.7.7-3.2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  className="smp-domain-icon-button is-danger"
                  type="button"
                  aria-label={`${copy.remove} ${domain.name}`}
                  title={copy.remove}
                  onClick={(event) => {
                    event.stopPropagation()
                    setRemoving(domain)
                  }}
                >
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                    <path
                      d="M3 4.5h10M6 4.5V2.8h4v1.7M4.5 4.5l.6 9h5.8l.6-9M6.5 7v4M9.5 7v4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {domains !== null && domains.length === 0 && <p className="smp-domain-hint">{copy.empty}</p>}
          {domains === null && <p className="smp-domain-hint">{copy.loading}</p>}
        </nav>
      </aside>
      <div className="smp-domain-main">
        <Panel
          title={
            <>
              {copy.records}
              {current !== undefined && <span className="smp-domain-current">{current.name}</span>}
            </>
          }
          extra={
            <div className="row smp-domain-tools">
              <button
                className={`smp-domain-header-icon${loadingDns ? ' is-busy' : ''}`}
                type="button"
                aria-label={copy.refresh}
                title={copy.refresh}
                disabled={selected === '' || loadingDns}
                onClick={() => setReload((value) => value + 1)}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path
                    d="M13 5.2A5.5 5.5 0 0 0 3.5 4M13 2.5v3.2h-3.2M3 10.8A5.5 5.5 0 0 0 12.5 12M3 13.5v-3.2h3.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          }
        >
          {failure !== null && (
            <p className="banner error" role="alert">
              {messageOf(copy, failure)}
            </p>
          )}
          {current === undefined ? (
            <p className="smp-domain-empty">{domains === null && loadingDomains ? copy.loading : copy.selectHint}</p>
          ) : (
            <div className="table-wrap smp-domain-table-scroll">
              <table className="smp-table" aria-label={copy.records}>
                <thead>
                  <tr>
                    <th>{copy.type}</th>
                    <th>{copy.name}</th>
                    <th>{copy.content}</th>
                    <th>TTL</th>
                    <th>{copy.proxied}</th>
                    <th>{copy.updated}</th>
                  </tr>
                </thead>
                <tbody>
                  {(records ?? []).map((record) => (
                    <tr key={record.id}>
                      <td className="nowrap">
                        <span className="smp-domain-type">{record.type}</span>
                      </td>
                      <td className="mono">{record.name}</td>
                      <td className="mono">{record.content}</td>
                      <td className="nowrap">{record.ttl === 1 ? 'Auto' : record.ttl}</td>
                      <td className="nowrap">
                        <span className={`pill${record.proxied ? ' online' : ''}`}>{record.proxied ? copy.proxiedOn : copy.proxiedOff}</span>
                      </td>
                      <td className="nowrap muted">{formatTime(record.modifiedOn, active)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records === null && (
                <p className="smp-domain-empty">{loadingDns ? copy.loading : copy.noRecords}</p>
              )}
              {records !== null && records.length === 0 && <p className="smp-domain-empty">{copy.noRecords}</p>}
            </div>
          )}
        </Panel>
      </div>
      <AddDomainDialog
        open={adding}
        copy={copy}
        onClose={() => setAdding(false)}
        onAdded={(domain) => {
          setAdding(false)
          void loadDomains(domain.id)
        }}
      />
      <EditDomainDialog
        domain={editing}
        copy={copy}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void loadDomains()
        }}
      />
      <DeleteDomainDialog
        domain={removing}
        copy={copy}
        onClose={() => setRemoving(null)}
        onDeleted={(id) => {
          setRemoving(null)
          setSelected((current) => (current === id ? '' : current))
          void loadDomains()
        }}
      />
    </div>
  )
}

function AddDomainDialog(props: {
  open: boolean
  copy: Copy
  onClose: () => void
  onAdded: (domain: DomainRow) => void
}) {
  const { copy } = props
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [accountId, setAccountId] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  useEffect(() => {
    if (props.open) return
    setName('')
    setDescription('')
    setAccountId('')
    setToken('')
    setFailure(null)
    setBusy(false)
  }, [props.open])

  const submit = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const data = await api<{ domain: DomainRow }>('/console-api/domains', {
        method: 'POST',
        body: JSON.stringify({ name, accountId, token, description }),
      })
      props.onAdded(data.domain)
    } catch (cause) {
      setFailure(failureOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      className="smp-domain-dialog"
      title={copy.addTitle}
      closeLabel={copy.cancel}
      onClose={() => {
        if (!busy) props.onClose()
      }}
      description={copy.tokenHint}
      footer={
        <>
          <DialogButton disabled={busy} onClick={props.onClose}>
            {copy.cancel}
          </DialogButton>
          <DialogButton variant="primary" disabled={busy || name.trim() === '' || accountId.trim() === '' || token.trim() === ''} onClick={() => void submit()}>
            {busy ? copy.verifying : copy.submit}
          </DialogButton>
        </>
      }
    >
      <form
        className="smp-domain-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy) void submit()
        }}
      >
        <label>
          {copy.domainLabel}
          <input
            value={name}
            placeholder={copy.domainPlaceholder}
            autoFocus
            required
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {copy.descriptionLabel}
          <textarea
            value={description}
            maxLength={200}
            rows={3}
            placeholder={copy.descriptionPlaceholder}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          {copy.accountIdLabel}
          <input
            value={accountId}
            placeholder={copy.accountIdPlaceholder}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={busy}
            onChange={(event) => setAccountId(event.target.value)}
          />
        </label>
        <label>
          {copy.tokenLabel}
          <input
            type="password"
            value={token}
            placeholder="Cloudflare API token"
            required
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {failure !== null && (
          <p className="banner error" role="alert">
            {messageOf(copy, failure)}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

function EditDomainDialog(props: {
  domain: DomainRow | null
  copy: Copy
  onClose: () => void
  onSaved: () => void
}) {
  const { copy } = props
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  useEffect(() => {
    setValue(props.domain?.description ?? '')
    setFailure(null)
    setBusy(false)
  }, [props.domain])

  const submit = async () => {
    if (props.domain === null) return
    setBusy(true)
    setFailure(null)
    try {
      await api<{ domain: DomainRow }>(`/console-api/domains/${props.domain.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: value }),
      })
      props.onSaved()
    } catch (cause) {
      setFailure(failureOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={props.domain !== null}
      title={copy.editTitle}
      closeLabel={copy.cancel}
      onClose={() => {
        if (!busy) props.onClose()
      }}
      footer={
        <>
          <DialogButton disabled={busy} onClick={props.onClose}>
            {copy.cancel}
          </DialogButton>
          <DialogButton variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? copy.verifying : copy.save}
          </DialogButton>
        </>
      }
    >
      <form
        className="smp-domain-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy) void submit()
        }}
      >
        <label>
          {copy.descriptionLabel}
          <textarea
            value={value}
            maxLength={200}
            rows={3}
            placeholder={copy.descriptionPlaceholder}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {failure !== null && (
          <p className="banner error" role="alert">
            {messageOf(copy, failure)}
          </p>
        )}
      </form>
    </Dialog>
  )
}

function DeleteDomainDialog(props: {
  domain: DomainRow | null
  copy: Copy
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const { copy } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  useEffect(() => {
    setFailure(null)
    setBusy(false)
  }, [props.domain])

  const submit = async () => {
    if (props.domain === null) return
    setBusy(true)
    setFailure(null)
    try {
      await api<undefined>(`/console-api/domains/${props.domain.id}`, { method: 'DELETE' })
      props.onDeleted(props.domain.id)
    } catch (cause) {
      setFailure(failureOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={props.domain !== null}
      title={copy.deleteTitle}
      closeLabel={copy.cancel}
      onClose={() => {
        if (!busy) props.onClose()
      }}
      footer={
        <>
          <DialogButton disabled={busy} onClick={props.onClose}>
            {copy.cancel}
          </DialogButton>
          <DialogButton variant="danger" disabled={busy} onClick={() => void submit()}>
            {copy.remove}
          </DialogButton>
        </>
      }
    >
      <p>{copy.deleteHint}</p>
      <p className="mono">{props.domain?.name ?? ''}</p>
      {failure !== null && (
        <p className="banner error" role="alert">
          {messageOf(copy, failure)}
        </p>
      )}
    </Dialog>
  )
}
