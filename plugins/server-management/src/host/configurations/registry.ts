import * as repository from './persistence/repository.ts'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { Db } from '../database/connection.ts'
import { transaction } from '../database/transaction.ts'
import type { Registration } from '../../shared/contracts/definitions.ts'
import type { ConfigurationOperation, ConfigurationContext, ConfigurationTask } from './contracts.ts'
import type { Json } from '../../shared/contracts/common.ts'

interface Installed { operation: ConfigurationOperation; users: Set<Promise<unknown>> }
export class ConfigurationRegistry {
  private closed = false
  private entries = new Map<string, Installed>()
  private readonly db: Db
  constructor(db: Db) { this.db = db }
  register(operation: ConfigurationOperation): Registration {
    const key = `${operation.owner}/${operation.key}`
    if (this.closed || this.entries.has(key) || !/^[a-z][a-z0-9-]*$/.test(operation.key)) throw new Error('configuration_registration_invalid')
    const entry: Installed = { operation, users: new Set() }
    this.entries.set(key, entry)
    return { ready: Promise.resolve(), dispose: async () => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      await Promise.allSettled([...entry.users])
    } }
  }
  keys(): string[] { return [...this.entries.keys()] }
  async close(): Promise<void> {
    this.closed = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.allSettled(entries.flatMap(entry => [...entry.users]))
  }
  async execute(key: string, context: ConfigurationContext): Promise<Json> {
    const entry = this.entries.get(key)
    if (!entry) throw new Error('configuration_provider_unavailable')
    const task = Promise.resolve().then(() => entry.operation.execute(context))
    entry.users.add(task)
    try { return await task } finally { entry.users.delete(task) }
  }
  async enqueue(request: { serverId: string; operation: string; input: Json; idempotencyKey: string }): Promise<ConfigurationTask> {
    const entry = this.entries.get(request.operation)
    if (!entry) throw new Error('configuration_provider_unavailable')
    if (!request.idempotencyKey || request.idempotencyKey.length > 240) throw new Error('configuration_idempotency_invalid')
    const input = entry.operation.validate(request.input)
    const snapshot = { action: 'configure', operation: request.operation, input }
    const task = transaction(this.db, async db => {
      const server = (await repository.lockServer(db, request.serverId)).rows[0]
      if (!server) throw new Error('server_not_found')
      const key = `${request.operation}:${request.idempotencyKey}`
      const existing = (await repository.existing(db, key)).rows[0]
      if (existing) {
        if (existing.server_id !== request.serverId || !isDeepStrictEqual(existing.request_snapshot.input, input)) throw new Error('configuration_idempotency_conflict')
        return { id: existing.id, serverId: existing.server_id, state: existing.state, result: existing.result }
      }
      const id = randomUUID()
      await repository.insert(db, { id, serverId: request.serverId, configRevision: server.config_revision, environmentRevision: server.environment_revision, key, operationId: randomUUID(), snapshot: JSON.stringify(snapshot) })
      return { id, serverId: request.serverId, state: 'queued', result: null }
    })
    entry.users.add(task)
    try { return await task } finally { entry.users.delete(task) }
  }
  async task(id: string): Promise<ConfigurationTask | undefined> {
    const row = (await repository.task(this.db, id)).rows[0]
    return row && { id: row.id, serverId: row.server_identity, state: row.state, result: row.result }
  }
}
