import type { Json } from '../../shared/contracts/common.ts'
import type { Registration } from '../../shared/contracts/definitions.ts'
import type { DbClient } from '../database/connection.ts'

/** Trusted host-only operation. Input, result and errors must never contain secrets. */
export interface ConfigurationContext {
  server: { id: string; typeKey: string; configRevision: string }
  recovering: boolean
  operationId: string
  sequence: string
  fence: string
  input: Json
  guard(): Promise<void>
  commit<T>(run: (db: DbClient) => Promise<T>): Promise<T>
  exec(command: string, timeoutMs: number, options?: { stdin?: string; outputLimitBytes?: number }): Promise<{ code: number; stdout: string; stderr: string }>
}
export interface ConfigurationOperation {
  owner: string
  key: string
  validate(input: unknown): Json
  execute(context: ConfigurationContext): Promise<Json>
}
export interface ConfigurationTask {
  id: string
  serverId: string
  state: string
  result: Json | null
}
export interface ConfigurationHostContract {
  registerConfigurationOperation(operation: ConfigurationOperation): Registration
  enqueueConfiguration(input: { serverId: string; operation: string; input: Json; idempotencyKey: string }): Promise<ConfigurationTask>
  configurationTask(id: string): Promise<ConfigurationTask | undefined>
}
