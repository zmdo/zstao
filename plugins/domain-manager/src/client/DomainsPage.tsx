import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Panel } from '@smp/console-kit'
import { Dialog, DialogButton } from '@smp/console-kit/dialog'
import { ApiError, api, type LocaleFace } from './api.ts'
import { copyFor, type Copy } from './copy.ts'

interface DomainRow {
  id: string
  name: string
  zoneId: string
  accountName: string
  status: string
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
  const active = useSyncExternalStore(props.locale.subscribe, () => props.locale.getSnapshot().active)
  const copy = copyFor(active)
  const [domains, setDomains] = useState<DomainRow[] | null>(null)
  const [selected, setSelected] = useState('')
  const [records, setRecords] = useState<DnsRow[] | null>(null)
  const [loadingDomains, setLoadingDomains] = useState(true)
  const [loadingDns, setLoadingDns] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [reload, setReload] = useState(0)
  const [adding, setAdding] = useState(false)

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
            <button
              className={`smp-domain-item${domain.id === selected ? ' is-on' : ''}`}
              key={domain.id}
              type="button"
              aria-current={domain.id === selected ? 'true' : undefined}
              onClick={() => {
                setFailure(null)
                setSelected(domain.id)
              }}
              title={domain.name}
            >
              <span className="smp-domain-name">{domain.name}</span>
              <span className="smp-domain-account">{domain.accountName}</span>
            </button>
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
              <button className="secondary" type="button" disabled={selected === '' || loadingDns} onClick={() => setReload((value) => value + 1)}>
                {copy.refresh}
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
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  useEffect(() => {
    if (props.open) return
    setName('')
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
        body: JSON.stringify({ name, token }),
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
          <DialogButton variant="primary" disabled={busy || name.trim() === '' || token.trim() === ''} onClick={() => void submit()}>
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
