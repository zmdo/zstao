import type { ServerTypeView, SoftwareView } from '../../../shared/definitions.ts'
import { ServerError } from '../../../shared/errors.ts'
import type { DeclaredOs, DetectedOs } from '../../../shared/operating-systems.ts'
import { api } from '../../shared/api.ts'
export interface ConnectionResult {
  fingerprint: string
  connection_token: string
  expires_at: number
}

export interface IdentificationResult {
  declared_os: DeclaredOs
  detected_os: DetectedOs
  type_key: string
  required_software: SoftwareView[]
  software_status: Record<
    string,
    {
      state?: string
      installed?: boolean
      detail?: string
      version?: string
      last_known_version?: string
      revision?: string
    }
  >
  software_available: boolean
  detected_at: string
}

interface Selection {
  groupId: string
  typeKey: string
  os?: DeclaredOs
  types: readonly ServerTypeView[]
}

function selectionKey(selection: Selection): string {
  const os = selection.os
  return JSON.stringify([
    selection.groupId,
    selection.typeKey,
    os?.kind === 'catalog' ? [os.family, os.releaseKey, os.version, os.precision] : os,
    selection.types.find((type) => type.key === selection.typeKey),
  ])
}

/** A form owns its receipts, in-flight requests and type-specific observations. */
export class EnrollmentPreview {
  private revision?: number
  private generation = 0
  private connection?: ConnectionResult
  private testing?: Promise<ConnectionResult>
  private readonly observations = new Map<string, IdentificationResult>()
  private readonly identifying = new Map<string, Promise<IdentificationResult>>()
  private readonly controllers = new Set<AbortController>()
  private readonly request: typeof api
  private readonly now: () => number

  constructor(request = api, now = Date.now) {
    this.request = request
    this.now = now
  }

  clear(): void {
    this.generation++
    this.revision = undefined
    this.connection = undefined
    this.testing = undefined
    this.observations.clear()
    this.identifying.clear()
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  sync(revision: number): void {
    if (this.revision !== revision || (this.connection && this.connection.expires_at <= this.now())) {
      this.clear()
      this.revision = revision
    }
  }

  cached(revision: number, selection: Selection): IdentificationResult | undefined {
    this.sync(revision)
    return this.observations.get(selectionKey(selection))
  }

  test(revision: number, authentication: object, force = false): Promise<ConnectionResult> {
    this.sync(revision)
    if (force) {
      this.clear()
      this.revision = revision
    }
    if (this.connection) return Promise.resolve(this.connection)
    if (this.testing) return this.testing
    const generation = this.generation
    const task = this.post<ConnectionResult>('/console-api/servers/test-connection', authentication)
      .then((connection) => {
        this.assertCurrent(generation)
        this.connection = connection
        return connection
      })
      .finally(() => {
        if (this.testing === task) this.testing = undefined
      })
    this.testing = task
    return task
  }

  async identify(revision: number, authentication: object, selection: Selection, force = false) {
    this.sync(revision)
    const generation = this.generation
    const connection = await this.test(revision, authentication)
    this.assertCurrent(generation)
    const key = selectionKey(selection)
    if (force) this.observations.delete(key)
    const cached = this.observations.get(key)
    if (cached) return { connection, identification: cached, cached: true }
    let task = this.identifying.get(key)
    if (!task) {
      const pending = this.post<IdentificationResult>('/console-api/servers/identify-system', {
        ...authentication,
        connection_token: connection.connection_token,
        group_id: selection.groupId || null,
        type_key: selection.typeKey,
      })
        .then((result) => {
          this.assertCurrent(generation)
          // The host may correct the OS or choose a compatible fallback type.
          const actual = selectionKey({ ...selection, os: result.declared_os, typeKey: result.type_key })
          this.observations.set(actual, result)
          return result
        })
        .catch((cause: unknown) => {
          if (
            generation === this.generation &&
            cause instanceof ServerError &&
            (cause.code === 'connection_test_required' ||
              cause.code === 'fingerprint_mismatch' ||
              cause.code.startsWith('ssh_'))
          )
            this.clear()
          throw cause
        })
        .finally(() => {
          if (this.identifying.get(key) === pending) this.identifying.delete(key)
        })
      task = pending
      this.identifying.set(key, pending)
    }
    return { connection, identification: await task, cached: false }
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new ServerError('connection_test_required')
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const controller = new AbortController()
    this.controllers.add(controller)
    try {
      return await this.request<T>(path, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (cause) {
      if (controller.signal.aborted) throw new ServerError('connection_test_required', {}, { cause })
      throw cause
    } finally {
      this.controllers.delete(controller)
    }
  }
}
