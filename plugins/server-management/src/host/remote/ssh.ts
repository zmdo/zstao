import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Client, ClientErrorExtensions, ConnectConfig } from 'ssh2'
import { ServerError, type ErrorCode, type MessageParams } from '../../shared/errors.ts'

const { Client: SshClient, utils } = createRequire(import.meta.url)('ssh2') as typeof import('ssh2')

export class SshError extends ServerError {
  readonly fingerprint?: string

  constructor(code: ErrorCode, fingerprint?: string, params: MessageParams = {}, options?: ErrorOptions) {
    super(code, params, options)
    this.name = 'SshError'
    this.fingerprint = fingerprint
  }
}

export class FingerprintMismatch extends SshError {
  constructor(actual: string) {
    super('fingerprint_mismatch', actual, { fingerprint: actual })
    this.name = 'FingerprintMismatch'
  }
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface SshSession {
  readonly fingerprint: string
  exec(
    command: string,
    timeoutMs: number,
    options?: { stdin?: string; outputLimitBytes?: number },
  ): Promise<CommandResult>
  putScript(name: string, body: Buffer): Promise<void>
  shell(cols: number, rows: number): Promise<ShellChannel>
  close(): void
}

export interface ShellChannel {
  write(data: Buffer | string): void
  resize(cols: number, rows: number): void
  onData(listener: (chunk: Buffer) => void): void
  onClose(listener: () => void): void
  close(): void
}

const REMOTE_DIR = '/tmp/smp-components'
type ConnectionPhase = 'connect' | 'handshake' | 'authentication'

export function fingerprintOf(raw: Buffer): string {
  return `SHA256:${createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')}`
}

/** OpenSSH-style fingerprint of a PEM private key. A passphrase is refused. */
export function keyFingerprint(secret: string): string {
  const normalized = normalizePem(secret)
  let parsed: unknown
  try {
    parsed = utils.parseKey(normalized)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    if (message.toLowerCase().includes('passphrase') || message.toLowerCase().includes('encrypted')) {
      throw new SshError('key_encrypted', undefined, {}, { cause })
    }
    throw new SshError('key_invalid', undefined, {}, { cause })
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (key instanceof Error || key === undefined || typeof key.getPublicSSH !== 'function') {
    const message = key instanceof Error ? key.message : ''
    if (message.toLowerCase().includes('passphrase') || message.toLowerCase().includes('encrypted')) {
      throw new SshError('key_encrypted', undefined, {}, { cause: key })
    }
    throw new SshError('key_invalid', undefined, {}, { cause: key instanceof Error ? key : undefined })
  }
  return fingerprintOf(key.getPublicSSH())
}

export function connectSsh(input: {
  host: string
  port: number
  username: string
  authMethod: string
  secret: string
  expectedFingerprint: string | null
  readyTimeoutMs?: number
}): Promise<SshSession> {
  return new Promise((resolve, reject) => {
    const client = new SshClient()
    const readyTimeoutMs = input.readyTimeoutMs ?? 30_000
    let phase: ConnectionPhase = 'connect'
    let seen = ''
    let mismatch = ''
    let settled = false
    const fail = (error: SshError) => {
      if (settled) return
      settled = true
      client.destroy()
      reject(error)
    }
    const config: ConnectConfig = {
      host: input.host,
      port: input.port,
      username: input.username,
      readyTimeout: readyTimeoutMs,
      tryKeyboard: false,
      hostVerifier: (key: Buffer) => {
        seen = fingerprintOf(Buffer.isBuffer(key) ? key : Buffer.from(key))
        if (input.expectedFingerprint && seen !== input.expectedFingerprint) {
          mismatch = seen
          return false
        }
        return true
      },
    }
    if (input.authMethod === 'password') config.password = input.secret
    else if (input.authMethod === 'private_key') config.privateKey = normalizePem(input.secret)
    else {
      fail(new SshError('auth_unsupported'))
      return
    }
    client.on('connect', () => {
      phase = 'handshake'
    })
    client.on('handshake', () => {
      phase = 'authentication'
    })
    client.on('ready', () => {
      if (settled) return
      if (seen === '') {
        fail(new SshError('fingerprint_missing'))
        return
      }
      settled = true
      resolve(sessionFor(client, seen))
    })
    client.on('error', (cause: Error) => {
      if (mismatch !== '') {
        fail(new FingerprintMismatch(mismatch))
        return
      }
      fail(mapConnectError(cause, seen, phase, readyTimeoutMs))
    })
    client.on('close', () => {
      fail(new SshError('ssh_closed', seen || undefined))
    })
    try {
      client.connect(config)
    } catch (cause) {
      fail(
        mapConnectError(
          cause instanceof Error ? cause : new Error(String(cause)),
          seen,
          phase,
          readyTimeoutMs,
        ),
      )
    }
  })
}

function sessionFor(client: Client, fingerprint: string): SshSession {
  return {
    fingerprint,
    exec: (command, timeoutMs, options) => execCommand(client, command, timeoutMs, options),
    putScript: (name, body) => uploadScript(client, name, body),
    shell: (cols, rows) => openShell(client, cols, rows),
    close: () => {
      client.end()
    },
  }
}

function execCommand(
  client: Client,
  command: string,
  timeoutMs: number,
  options: { stdin?: string; outputLimitBytes?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let channel: { close(): void } | undefined
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run()
    }
    // ssh2 ignores a timeout on exec. Close the channel ourselves.
    const timer = setTimeout(() => {
      channel?.close()
      finish(() => reject(new SshError('command_timeout')))
    }, timeoutMs)
    try {
      client.exec(command, (cause, stream) => {
        if (settled) {
          stream?.close()
          return
        }
        if (cause) {
          finish(() =>
            reject(new SshError('command_failed', undefined, { detail: cause.message }, { cause })),
          )
          return
        }
        channel = stream
        const out: Buffer[] = []
        const err: Buffer[] = []
        let bytes = 0
        const append = (target: Buffer[], chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > (options.outputLimitBytes ?? 1_048_576)) {
            stream.close()
            finish(() => reject(new SshError('recipe_protocol')))
          } else target.push(chunk)
        }
        stream.on('data', (chunk: Buffer) => {
          append(out, chunk)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          append(err, chunk)
        })
        stream.on('error', (cause: Error) => {
          finish(() => reject(new SshError('command_failed', undefined, {}, { cause })))
        })
        if (options.stdin !== undefined) stream.end(options.stdin)
        stream.on('close', (code: number) => {
          finish(() =>
            resolve({
              code: code ?? 0,
              stdout: Buffer.concat(out).toString('utf8'),
              stderr: Buffer.concat(err).toString('utf8'),
            }),
          )
        })
      })
    } catch (cause) {
      finish(() => reject(new SshError('command_failed', undefined, {}, { cause })))
    }
  })
}

function uploadScript(client: Client, name: string, body: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((cause, sftp) => {
      if (cause) {
        reject(new SshError('upload_failed', undefined, { detail: cause.message }, { cause }))
        return
      }
      sftp.mkdir(REMOTE_DIR, (mkdirCause) => {
        void mkdirCause
        const remote = `${REMOTE_DIR}/${name}`
        const handle = sftp.createWriteStream(remote, { mode: 0o700 })
        handle.on('error', (error: Error) => {
          sftp.end()
          reject(new SshError('upload_failed', undefined, { detail: error.message }, { cause: error }))
        })
        handle.on('close', () => {
          sftp.end()
          resolve()
        })
        handle.end(body.toString('utf8').replaceAll('\r\n', '\n'))
      })
    })
  })
}

function openShell(client: Client, cols: number, rows: number): Promise<ShellChannel> {
  return new Promise((resolve, reject) => {
    client.shell({ term: 'xterm-256color', cols, rows }, (cause, stream) => {
      if (cause) {
        reject(new SshError('shell_failed', undefined, { detail: cause.message }, { cause }))
        return
      }
      resolve({
        write: (data) => {
          stream.write(data)
        },
        resize: (nextCols, nextRows) => {
          stream.setWindow(nextRows, nextCols, 0, 0)
        },
        onData: (listener) => {
          stream.on('data', listener)
        },
        onClose: (listener) => {
          stream.on('close', listener)
        },
        close: () => {
          stream.close()
        },
      })
    })
  })
}

function mapConnectError(
  cause: Error & ClientErrorExtensions & { code?: string | number },
  fingerprint: string,
  phase: ConnectionPhase,
  readyTimeoutMs: number,
): SshError {
  if (cause.level === 'client-authentication') {
    return new SshError('ssh_auth_failed', fingerprint || undefined, {}, { cause })
  }
  if (cause.level === 'client-timeout' || cause.code === 'ETIMEDOUT') {
    const code =
      phase === 'connect'
        ? 'ssh_connect_timeout'
        : phase === 'handshake'
          ? 'ssh_handshake_timeout'
          : 'ssh_auth_timeout'
    return new SshError(code, fingerprint || undefined, { seconds: readyTimeoutMs / 1000 }, { cause })
  }
  if (cause.code === 'ECONNREFUSED') {
    return new SshError('ssh_refused', fingerprint || undefined, {}, { cause })
  }
  const message = cause.message.toLowerCase()
  if (message.includes('passphrase') || message.includes('encrypted')) {
    return new SshError('key_encrypted', undefined, {}, { cause })
  }
  return new SshError('ssh_failed', fingerprint || undefined, { detail: cause.message }, { cause })
}

function normalizePem(secret: string): string {
  const text = secret.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return text.endsWith('\n') ? text : `${text}\n`
}
