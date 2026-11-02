import { format } from '../../../shared/i18n.ts'
import type { ServerFormModel } from './useServerForm.ts'
export function AuthenticationFields(props: { form: ServerFormModel }) {
  const {
    busy,
    canTest,
    copy,
    currentConnection,
    host,
    keyId,
    keyName,
    keys,
    loadedServer,
    method,
    pending,
    port,
    preview,
    secret,
    setHost,
    setKeyId,
    setKeyName,
    setMethod,
    setPort,
    setSecret,
    setUser,
    user,
  } = props.form
  return (
    <section className="smp-server-form-section smp-card" aria-label={copy.authenticationInfo}>
      <h2>{copy.authenticationInfo}</h2>
      <div className="smp-server-form-section-body">
        <div className="smp-server-address-row">
          <label className="field">
            {copy.hostAddress}
            <input
              value={host}
              onChange={(event) => {
                setHost(event.target.value)
              }}
            />
          </label>
          <label className="field">
            {copy.port}
            <input
              value={port}
              onChange={(event) => {
                setPort(event.target.value)
              }}
            />
          </label>
        </div>
        <label className="field">
          {copy.user}
          <input
            value={user}
            onChange={(event) => {
              setUser(event.target.value)
            }}
          />
        </label>
        <label className="field">
          {copy.authMethod}
          <select
            value={method}
            onChange={(event) => {
              setMethod(event.target.value)
              setSecret('')
            }}
          >
            <option value="private_key">{copy.privateKey}</option>
            <option value="password">{copy.password}</option>
          </select>
        </label>
        {method === 'private_key' ? (
          <>
            <label className="field">
              {copy.existingKey}
              <select
                value={keyId}
                onChange={(event) => {
                  setKeyId(event.target.value)
                }}
              >
                <option value="">{copy.noKey}</option>
                {keys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.name}
                  </option>
                ))}
              </select>
            </label>
            {keyId === '' && (
              <>
                <label className="field">
                  {copy.newKeyName}
                  <input
                    value={keyName}
                    onChange={(event) => {
                      setKeyName(event.target.value)
                    }}
                  />
                </label>
                <label className="field">
                  {copy.pasteKey}
                  <textarea
                    value={secret}
                    onChange={(event) => {
                      setSecret(event.target.value)
                    }}
                    placeholder={copy.secretHint}
                  />
                </label>
              </>
            )}
          </>
        ) : (
          <label className="field">
            {copy.password}
            <input
              type="password"
              value={secret}
              onChange={(event) => {
                setSecret(event.target.value)
              }}
            />
          </label>
        )}
        {method === 'password' && loadedServer?.auth_method === 'password' && (
          <p className="muted">{copy.savedPasswordHint}</p>
        )}
        {currentConnection && (
          <p className="banner ok">
            {format(copy.connected, { fingerprint: currentConnection.fingerprint })}
          </p>
        )}
      </div>
      <footer>
        <button
          className="secondary"
          type="button"
          disabled={!canTest || pending !== null || busy}
          onClick={() => {
            void preview()
          }}
        >
          {pending === 'test' ? copy.testingConnection : copy.testConnection}
        </button>
      </footer>
    </section>
  )
}
