import { type Db } from './database/connection.ts'
import { type Component } from './definitions/catalog.ts'
import { type DefinitionRegistry } from './definitions/registry.ts'
import { type Enrollment } from './servers/enrollment.ts'
import { type ServerExtensionRegistry } from './extensions/registry.ts'

interface Secrets {
  encrypt(secret: string): string
  decrypt(ciphertext: string): string
}
export interface Deps {
  localePreference?(): string | undefined
  adminRun?<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>
  db: Db
  secrets: Secrets
  catalog: readonly Component[]
  definitions: DefinitionRegistry
  extensions: ServerExtensionRegistry
  enrollment: Enrollment
  freshnessMs?: number
  updateCheckIntervalSeconds?: number
  execLimits?: import('./harness/exec.ts').ExecLimits
}
