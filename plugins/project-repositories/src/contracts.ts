export interface PullCredential {
  id: string
  revision: number
  registry: string
  repositories: string[]
  username: string
  configured: boolean
  enabled: boolean
  updatedAt: string | null
}
/** Host-only access. Secrets are resolved only when a configuration task executes. */
export interface RegistryCredentials {
  read(): Promise<PullCredential>
  resolve(id: string, revision: number): Promise<PullCredential & { password: string }>
}
