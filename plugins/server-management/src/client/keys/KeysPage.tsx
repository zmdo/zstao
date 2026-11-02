import type { KeyListDto } from '../../shared/dto/keys.ts'
import { Panel } from '@smp/console-kit'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ServerError } from '../../shared/errors.ts'
import { displayError, format, formatDate, serverCopy, type LocaleFace } from '../../shared/i18n.ts'
import { api, requestError } from '../shared/api.ts'
import { useActiveLocale } from '../shared/locale.ts'

export function KeysPage(props: { locale: LocaleFace }) {
  const active = useActiveLocale(props.locale)
  const copy = serverCopy(active).ui
  const [keys, setKeys] = useState<KeyListDto[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<ServerError | null>(null)
  const [revision, setRevision] = useState(0)
  const [adding, setAdding] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    let stopped = false
    void api<KeyListDto[]>('/console-api/ssh-keys')
      .then((rows) => {
        if (!stopped) setKeys(rows)
      })
      .catch((cause: unknown) => {
        if (!stopped) setError(requestError(cause))
      })
    return () => {
      stopped = true
    }
  }, [revision])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return keys
    return keys.filter(
      (key) => key.name.toLowerCase().includes(needle) || key.fingerprint.toLowerCase().includes(needle),
    )
  }, [keys, query])

  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const current = Math.min(page, pages)
  const rows = shown.slice((current - 1) * pageSize, current * pageSize)

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    try {
      await api('/console-api/ssh-keys', { method: 'POST', body: JSON.stringify({ name, secret }) })
      setName('')
      setSecret('')
      setAdding(false)
      setRevision((current) => current + 1)
    } catch (cause) {
      setError(requestError(cause))
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null)
    try {
      await api(`/console-api/ssh-keys/${id}`, { method: 'DELETE' })
      setKeys((current) => current.filter((key) => key.id !== id))
    } catch (cause) {
      setError(requestError(cause))
    }
  }

  return (
    <Panel
      className="smp-keys-panel smp-list-panel"
      title={copy.keysTitle}
      extra={
        <div className="row">
          <input
            className="search"
            value={query}
            placeholder={copy.searchKeys}
            aria-label={copy.searchKeys}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
          <button
            className="primary"
            type="button"
            onClick={() => {
              setAdding(true)
            }}
          >
            {copy.addKey}
          </button>
        </div>
      }
    >
      {error !== null ? (
        <p className="banner error" role="alert">
          {displayError(active, error)}
        </p>
      ) : null}
      {adding ? (
        <form
          className="panel-form"
          onSubmit={(event) => {
            void create(event)
          }}
        >
          <label className="field">
            {copy.name}
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
          </label>
          <label className="field">
            {copy.privateKey}
            <textarea
              value={secret}
              onChange={(event) => {
                setSecret(event.target.value)
              }}
              placeholder={copy.pemHint}
            />
          </label>
          <div className="row">
            <button className="primary" type="submit">
              {copy.save}
            </button>
            <button
              className="link"
              type="button"
              onClick={() => {
                setAdding(false)
              }}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      ) : null}
      <div className="table-wrap smp-keys-table-wrap smp-list-scroll">
        <table className="smp-table">
          <thead>
            <tr>
              <th>{copy.name}</th>
              <th>{copy.fingerprint}</th>
              <th>{copy.servers}</th>
              <th>{copy.createdAt}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  {query.trim() === '' ? copy.noKeys : copy.noMatchingKeys}
                </td>
              </tr>
            ) : (
              rows.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td className="mono">{key.fingerprint}</td>
                  <td>{key.server_count}</td>
                  <td>{formatDate(key.created_at, active)}</td>
                  <td>
                    {key.server_count > 0 ? null : (
                      <button
                        className="link danger"
                        type="button"
                        onClick={() => {
                          void remove(key.id)
                        }}
                      >
                        {copy.delete}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <footer className="smp-server-pager smp-keys-pager smp-list-pager" aria-label={copy.keysPagination}>
        <span>
          {format(shown.length ? copy.keysRange : copy.keysTotal, {
            count: shown.length,
            from: (current - 1) * pageSize + 1,
            to: Math.min(current * pageSize, shown.length),
          })}
        </span>
        <div className="row">
          <label>
            {copy.perPage}
            <select
              aria-label={copy.keysPageSize}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>
            {copy.previous}
          </button>
          <span aria-live="polite">{format(copy.page, { page: current, pages })}</span>
          <button className="secondary" type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>
            {copy.next}
          </button>
        </div>
      </footer>
    </Panel>
  )
}
