import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApiError } from './onedev.ts'
import type { PullCredential, RegistryCredentials } from './contracts.ts'

type Stored = Omit<PullCredential, 'configured'> & { passwordCiphertext: string }
const initial = (): Stored => ({ id: 'platform-pull', revision: 0, registry: 'ccr.ccs.tencentyun.com', repositories: [], username: '', passwordCiphertext: '', enabled: false, updatedAt: null })
export class PullCredentials implements RegistryCredentials {
  private tail: Promise<unknown> = Promise.resolve()
  private file: string
  private secrets: { encrypt(text: string): string; decrypt(text: string): string }
  constructor(file: string, secrets: { encrypt(text: string): string; decrypt(text: string): string }) { this.file = file; this.secrets = secrets }
  async read(): Promise<PullCredential> { return publicValue(await this.stored()) }
  async resolve(id: string, revision: number): Promise<PullCredential & { password: string }> {
    const value = await this.stored()
    if (value.id !== id || value.revision !== revision) throw new ApiError(409, 'pull_credential_changed')
    if (!publicValue(value).configured) throw new ApiError(409, 'pull_credential_unavailable')
    return { ...publicValue(value), password: this.secrets.decrypt(value.passwordCiphertext) }
  }
  save(input: Record<string, unknown>): Promise<PullCredential> {
    const task = this.tail.then(async () => {
      const old = await this.stored()
      if (input.expectedRevision !== old.revision) throw new ApiError(409, 'pull_credential_changed')
      if (typeof input.enabled !== 'boolean') throw new ApiError(400, 'invalid_pull_credential')
      const registry = typeof input.registry === 'string' ? input.registry.trim() : old.registry
      const username = typeof input.username === 'string' ? input.username.trim() : old.username
      const repositories = input.repositories === undefined ? old.repositories : validateRepositories(input.repositories)
      const password = input.password === undefined ? '' : input.password
      if (typeof password !== 'string' || password.length > 8192 || /[\r\n\0]/.test(password)) throw new ApiError(400, 'invalid_pull_credential')
      if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]{1,5})?$/.test(registry) || registry.length > 253 || username.length > 256 || /[\s:\0]/.test(username)) throw new ApiError(400, 'invalid_pull_credential')
      if (input.enabled && (!username || (!password && !old.passwordCiphertext) || !repositories.length)) throw new ApiError(400, 'pull_credential_incomplete')
      // Disabling explicitly erases the platform copy; an empty password otherwise keeps it.
      const passwordCiphertext = !input.enabled ? '' : password ? this.secrets.encrypt(password) : old.passwordCiphertext
      const changedPassword = password !== '' && (old.passwordCiphertext === '' || this.secrets.decrypt(old.passwordCiphertext) !== password)
      if (registry === old.registry && username === old.username && JSON.stringify(repositories) === JSON.stringify(old.repositories) && input.enabled === old.enabled && !changedPassword) return publicValue(old)
      const next: Stored = { id: old.id, registry, username, repositories, passwordCiphertext, enabled: input.enabled, revision: old.revision + 1, updatedAt: new Date().toISOString() }
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        const fd = await open(temporary, 'wx', 0o600)
        try { await fd.writeFile(JSON.stringify(next) + '\n'); await fd.sync() } finally { await fd.close() }
        await rename(temporary, this.file)
        const parent = await open(dirname(this.file), 'r')
        try { await parent.sync() } finally { await parent.close() }
      } finally { await rm(temporary, { force: true }) }
      return publicValue(next)
    })
    this.tail = task.catch(() => {})
    return task
  }
  async close(): Promise<void> { await this.tail }
  private async stored(): Promise<Stored> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as Stored
      if (value.id !== 'platform-pull' || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.passwordCiphertext !== 'string' || typeof value.enabled !== 'boolean' || typeof value.registry !== 'string' || typeof value.username !== 'string') throw new Error('invalid')
      validateRepositories(value.repositories)
      return value
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return initial()
      throw new ApiError(500, 'pull_credentials_unavailable')
    }
  }
}
export function validateRepositories(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?:\/\*)?$/.test(v) || v.length > 255)) throw new ApiError(400, 'invalid_repository_scope')
  return [...new Set(value as string[])].sort()
}
function publicValue(value: Stored): PullCredential {
  const { passwordCiphertext, ...rest } = value
  return { ...rest, configured: value.enabled && !!value.username && !!passwordCiphertext && !!value.repositories.length }
}
