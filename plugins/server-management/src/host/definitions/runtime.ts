import type { SshSession } from '../remote/ssh.ts'

/** Host-only; credentials resolved here must never be added to plans or recipe requests. */
export interface TypeSetupContext {
  operation: 'prepare' | 'remove'
  serverId: string
  sshUser: string
  exec: SshSession['exec']
  guard(): Promise<void>
}
export interface DefinitionRuntime {
  /** Local type keys owned by this definition bundle. Runs inside an existing server task. */
  types?: Record<string, (context: TypeSetupContext) => Promise<void>>
}
