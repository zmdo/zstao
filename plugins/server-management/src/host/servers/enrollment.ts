import { defaultTypeForOs, typeSupportsOs } from '../../shared/definitions.ts'
import { ServerError } from '../../shared/errors.ts'
import { declaredOsFromDetected } from '../../shared/operating-systems.ts'
import { type Db } from '../database/connection.ts'
import { type TypeLease } from '../definitions/model.ts'
import { type DefinitionRegistry } from '../definitions/registry.ts'
import { HttpError } from '../errors.ts'
import { field, text } from '../input.ts'
import { secretForConnection } from '../keys/persistence/repository.ts'
import { digest } from '../recipes/canonical.ts'
import { detectSoftware } from '../recipes/software.ts'
import { probeOs } from '../remote/os-probe.ts'
import { scrubValue } from '../remote/parse.ts'
import { connectSsh, type SshSession } from '../remote/ssh.ts'
import { serverSecret } from './persistence/credential-repository.ts'

interface Dependencies {
  db: Db
  definitions: DefinitionRegistry
  secrets: { encrypt(value: string): string; decrypt(value: string): string }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONNECTION_TTL = 10 * 60_000
type Credentials = Parameters<typeof connectSsh>[0] & { serverId: string; configRevision: string }

/** Owns every temporary SSH connection; registration previews never write server or software records. */
export class Enrollment {
  private stopped = false
  private readonly sessions = new Set<SshSession>()
  private readonly tasks = new Set<Promise<unknown>>()
  private readonly deps: Dependencies
  private readonly connect: typeof connectSsh
  constructor(deps: Dependencies, connect = connectSsh) {
    this.deps = deps
    this.connect = connect
  }

  test(body: unknown) {
    return this.run(async () => {
      const credentials = await this.credentials(body)
      return this.withSession(credentials, async (session) => {
        const expiresAt = Date.now() + CONNECTION_TTL
        return {
          ok: true,
          fingerprint: session.fingerprint,
          expires_at: expiresAt,
          connection_token: this.deps.secrets.encrypt(
            JSON.stringify({
              purpose: 'server-enrollment',
              digest: digest(credentials),
              fingerprint: session.fingerprint,
              expiresAt,
            }),
          ),
        }
      })
    })
  }

  identify(body: unknown) {
    return this.run(async () => {
      const credentials = await this.credentials(body)
      const receipt = this.receipt(body, credentials)
      return this.withSession(
        { ...credentials, expectedFingerprint: receipt.fingerprint },
        async (session) => {
          const probe = await probeOs(session)
          if (probe.state !== 'detected') throw new ServerError('os_probe_failed')
          const declared = declaredOsFromDetected(probe.os)
          const groupId = text(field(body, 'group_id')) || null
          if (groupId !== null && !UUID.test(groupId)) throw new ServerError('group_not_found')
          const options = await this.deps.definitions.options(groupId, probe.os)
          const types = options.types.filter(
            (type) => typeSupportsOs(type, declared) && typeSupportsOs(type, probe.os),
          )
          const requested = text(field(body, 'type_key'))
          const type =
            types.find((item) => item.key === requested) ??
            types.find((item) => item.key === defaultTypeForOs(options, declared)) ??
            types[0]
          let lease: TypeLease | undefined
          try {
            lease =
              options.available && type
                ? await this.deps.definitions.lease(groupId, type.key, probe.os)
                : undefined
            const status = lease ? await detectSoftware(session, lease.components, probe.os) : {}
            return {
              declared_os: declared,
              detected_os: probe.os,
              type_key: type?.key ?? '',
              required_software: lease?.type.software ?? type?.software ?? [],
              software_status: scrubValue(status, credentials.secret),
              software_available: lease !== undefined,
              detected_at: new Date().toISOString(),
            }
          } finally {
            lease?.release()
          }
        },
      )
    })
  }

  async close(): Promise<void> {
    this.stopped = true
    for (const session of this.sessions) session.close()
    await Promise.allSettled([...this.tasks])
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new ServerError('definitions_unavailable'))
    const task = work().finally(() => this.tasks.delete(task))
    this.tasks.add(task)
    return task
  }

  private async withSession<T>(
    credentials: Parameters<typeof connectSsh>[0],
    work: (session: SshSession) => Promise<T>,
  ): Promise<T> {
    if (this.stopped) throw new ServerError('definitions_unavailable')
    const session = await this.connect(credentials)
    this.sessions.add(session)
    try {
      if (this.stopped) throw new ServerError('definitions_unavailable')
      return await work(session)
    } finally {
      session.close()
      this.sessions.delete(session)
    }
  }

  private receipt(body: unknown, credentials: Credentials): { fingerprint: string } {
    let receipt: unknown
    try {
      receipt = JSON.parse(this.deps.secrets.decrypt(text(field(body, 'connection_token'))))
    } catch (_cause) {
      throw new ServerError('connection_test_required')
    }
    if (!receipt || typeof receipt !== 'object') throw new ServerError('connection_test_required')
    const value = receipt as Record<string, unknown>
    if (
      value.purpose !== 'server-enrollment' ||
      value.digest !== digest(credentials) ||
      typeof value.fingerprint !== 'string' ||
      !value.fingerprint ||
      typeof value.expiresAt !== 'number' ||
      value.expiresAt <= Date.now()
    )
      throw new ServerError('connection_test_required')
    return { fingerprint: value.fingerprint }
  }

  private async credentials(body: unknown): Promise<Credentials> {
    const host = text(field(body, 'host')),
      username = text(field(body, 'ssh_user'))
    if (!host) throw new HttpError(422, 'host_required')
    if (!username) throw new HttpError(422, 'user_required')
    const port = Number(field(body, 'ssh_port'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(422, 'port_invalid')
    const authMethod = text(field(body, 'auth_method'))
    if (authMethod !== 'password' && authMethod !== 'private_key') throw new HttpError(422, 'auth_required')
    const serverId = text(field(body, 'server_id'))
    if (serverId && !UUID.test(serverId)) throw new HttpError(404, 'server_not_found')
    const stored = serverId ? await serverSecret(this.deps.db, serverId) : undefined
    if (serverId && !stored) throw new HttpError(404, 'server_not_found')
    let secret = typeof field(body, 'secret') === 'string' ? (field(body, 'secret') as string) : ''
    const keyId = text(field(body, 'ssh_key_id'))
    if (authMethod === 'private_key' && keyId) {
      if (!UUID.test(keyId)) throw new HttpError(422, 'key_not_found')
      const key = (await secretForConnection(this.deps.db, keyId)).rows[0]
      if (!key) throw new HttpError(422, 'key_not_found')
      secret = this.deps.secrets.decrypt(key.secret_ciphertext)
    } else if (
      authMethod === 'password' &&
      !secret &&
      stored?.auth_method === 'password' &&
      stored.host === host &&
      stored.ssh_port === port &&
      stored.ssh_user === username
    ) {
      secret = this.deps.secrets.decrypt(stored.secret_ciphertext)
    }
    if (!secret.trim())
      throw new HttpError(422, authMethod === 'private_key' ? 'private_key_required' : 'password_required')
    return {
      host,
      port,
      username,
      authMethod,
      secret,
      serverId,
      configRevision: String(stored?.config_revision ?? ''),
      expectedFingerprint: stored?.host === host && stored.ssh_port === port ? stored.host_fingerprint : null,
    }
  }
}
