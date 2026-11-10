/** Host-only access. Never expose this return value through HTTP, AI tools or job snapshots. */
export interface ImageRegistryService {
  pullLogin(): Promise<{ registry: string; username: string; password: string }>
}
