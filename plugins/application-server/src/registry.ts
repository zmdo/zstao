import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { ConfigurationContext, ConfigurationHostContract, Db, Json } from '@smp/console-server-management/contracts'
import type { RegistryCredentials, PullCredential } from '@smp/console-project-repositories/contracts'

export const TYPE = '@smp/console-application-server/application-server'
export const OPERATION = '@smp/console-application-server/registry-credentials'
export class RegistryError extends Error {
  code: string
  status: number
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status }
}
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
export function repositoryOf(image: unknown): { registry: string; repository: string } {
  if (typeof image !== 'string' || image.length > 1024) throw new RegistryError('invalid_image', 400)
  const match = /^([a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]{1,5})?)\/([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+)@sha256:[a-f0-9]{64}$/.exec(image)
  if (!match) throw new RegistryError('digest_required', 400)
  return { registry: match[1]!, repository: match[2]! }
}
export function inScope(repository: string, scopes: readonly string[]): boolean {
  return scopes.some(scope => repository === scope || scope.endsWith('/*') && repository.startsWith(scope.slice(0, -1)))
}
export interface Binding {
  server_identity: string; server_id: string | null; credential_id: string; registry: string; repositories: string[]
  desired_revision: string; applied_revision: string | null; generation: string | null
  config_revision: string | null; active: boolean; state: string; job_id: string | null
  last_error: string | null; type_key?: string; current_config_revision?: string; retry_at: Date
}
const remoteErrors = new Set(['unsafe_path','invalid_request','superseded','registry_login_failed','registry_config_invalid','root_required','server_busy','remote_timeout','registry_operation_failed'])
export class RegistryManager {
  db: Db
  credentials: RegistryCredentials
  jobs: ConfigurationHostContract
  private source: Promise<string>
  constructor(db: Db, credentials: RegistryCredentials, jobs: ConfigurationHostContract) {
    this.db = db; this.credentials = credentials; this.jobs = jobs
    this.source = readFile(new URL('../scripts/registry.py', import.meta.url), 'utf8')
  }
  async bindings(): Promise<Binding[]> {
    return (await this.db.query<Binding>(`select b.*,s.type_key,s.config_revision as current_config_revision,(select r.pull_result from application_registry_requests r where r.server_identity=b.server_identity and r.reported_at is not null order by r.reported_at desc limit 1) as last_pull_result from application_registry_bindings b left join servers s on s.id=b.server_id order by b.updated_at desc`)).rows
  }
  async statusBindings(): Promise<Binding[]> {
    const [bindings, credential] = await Promise.all([this.bindings(), this.credentials.read()])
    return bindings.map(binding => ({ ...binding, desired_revision: String(credential.revision),
      state: binding.state === 'synced' && (String(binding.applied_revision) !== String(credential.revision) || String(binding.config_revision) !== String(binding.current_config_revision)) ? 'pending' : binding.state,
    }))
  }
  async prepare(serverId: string, image: string, credentialId: string, key: string) {
    if (!uuid(serverId)) throw new RegistryError('invalid_server', 400)
    const { registry, repository } = repositoryOf(image)
    const credential = await this.credentials.read()
    if (credential.id !== credentialId || !credential.configured) throw new RegistryError('pull_credential_unavailable')
    if (registry !== credential.registry || !inScope(repository, credential.repositories)) throw new RegistryError('image_scope_denied', 403)
    const server = (await this.db.query<{ type_key: string }>('select type_key from servers where id=$1', [serverId])).rows[0]
    if (!server || server.type_key !== TYPE) throw new RegistryError('application_server_required')
    await this.db.query(`insert into application_registry_bindings(server_identity,server_id,credential_id,registry,repositories,desired_revision)
      values($1,$1,$2,$3,$4,$5) on conflict(server_identity) do nothing`, [serverId, credential.id, credential.registry, JSON.stringify([repository]), credential.revision])
    const binding = (await this.db.query<Binding>('select * from application_registry_bindings where server_identity=$1', [serverId])).rows[0]!
    if (!binding.active || binding.credential_id !== credentialId || binding.registry !== registry) throw new RegistryError('binding_removed')
    await this.db.query(`update application_registry_bindings set repositories=(select jsonb_agg(distinct r) from jsonb_array_elements_text(repositories || $2::jsonb) r),desired_revision=$3,updated_at=now() where server_identity=$1 and active`, [serverId, JSON.stringify([repository]), credential.revision])
    return this.enqueue(serverId, credential, key)
  }
  async deploy(serverId: string, image: string, receipt: Json, key: string) {
    return this.jobs.enqueueConfiguration({ serverId, operation: OPERATION,
      input: { credentialId: 'platform-pull', revision: Number((receipt as { revision: number }).revision), mode: 'deploy', image, receipt }, idempotencyKey: key })
  }
  private async enqueue(serverId: string, credential: PullCredential, key: string) {
    const task = await this.jobs.enqueueConfiguration({ serverId, operation: OPERATION,
      input: { credentialId: credential.id, revision: credential.revision }, idempotencyKey: key })
    await this.db.query(`update application_registry_bindings set job_id=$2,desired_revision=$3,state=case when active then 'pending' else 'cleanup_pending' end,retry_at=now()+interval '60 seconds',updated_at=now() where server_identity=$1`, [serverId, task.id, credential.revision])
    return task
  }
  async setActive(serverId: string, active: boolean): Promise<void> {
    if (!uuid(serverId)) throw new RegistryError('invalid_server', 400)
    if (active) {
      const credential = await this.credentials.read()
      const binding = (await this.db.query<Binding>('select * from application_registry_bindings where server_identity=$1', [serverId])).rows[0]
      if (!binding || !credential.configured || !binding.repositories.every(repo => inScope(repo, credential.repositories))) throw new RegistryError('image_scope_denied', 403)
      await this.db.query('update application_registry_bindings set registry=$2 where server_identity=$1', [serverId, credential.registry])
    }
    await this.db.query(`update application_registry_bindings set active=$2,state=case when $2 then 'pending' else 'cleanup_pending' end,retry_at=now(),updated_at=now() where server_identity=$1`, [serverId, active])
  }
  async reconcile(): Promise<void> {
    const credential = await this.credentials.read()
    for (const binding of await this.bindings()) {
      if (!binding.server_id) {
        if (binding.state !== 'removed') await this.db.query("update application_registry_bindings set state='orphaned',last_error='server_deleted_cleanup_unconfirmed' where server_identity=$1", [binding.server_identity])
        continue
      }
      const allowed = credential.configured && binding.registry === credential.registry && binding.type_key === TYPE && binding.repositories.every(repo => inScope(repo, credential.repositories))
      if (!allowed && binding.active) {
        await this.setActive(binding.server_id, false)
        binding.active = false; binding.state = 'cleanup_pending'
      }
      if (!binding.active && binding.state === 'removed') continue
      const task = binding.job_id ? await this.jobs.configurationTask(binding.job_id) : undefined
      if (task && ['queued','claimed','running','recovering'].includes(task.state)) continue
      if (task && ['failed','blocked','cancelled'].includes(task.state) && binding.state === 'pending') {
        await this.db.query("update application_registry_bindings set state='failed',last_error='configuration_failed' where server_identity=$1", [binding.server_id])
      }
      const changed = String(credential.revision) !== String(binding.applied_revision) || String(binding.config_revision) !== String(binding.current_config_revision)
      if (!changed && binding.active && binding.state === 'synced') continue
      if (binding.retry_at.getTime() > Date.now() && String(binding.desired_revision) === String(credential.revision)) continue
      await this.enqueue(binding.server_id, credential, `reconcile:${randomUUID()}`)
    }
  }
  validate(input: unknown): Json {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RegistryError('invalid_request', 400)
    const row = input as Record<string, unknown>
    if (row.credentialId !== 'platform-pull' || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || Object.keys(row).some(key => !['credentialId','revision','mode','image','receipt'].includes(key))) throw new RegistryError('invalid_request', 400)
    if (row.mode !== undefined) {
      if (row.mode !== 'deploy' || !row.receipt || typeof row.receipt !== 'object' || Array.isArray(row.receipt)) throw new RegistryError('invalid_request', 400)
      repositoryOf(row.image)
      const receipt = row.receipt as Record<string, unknown>
      if (!uuid(receipt.serverId) || receipt.credentialId !== row.credentialId || receipt.revision !== row.revision || typeof receipt.configRevision !== 'string' || !/^[0-9]+$/.test(receipt.configRevision) || typeof receipt.generation !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(receipt.generation)) throw new RegistryError('invalid_request', 400)
      return { credentialId: row.credentialId, revision: Number(row.revision), mode: 'deploy', image: String(row.image), receipt: { serverId: receipt.serverId, credentialId: receipt.credentialId, revision: Number(receipt.revision), configRevision: receipt.configRevision, generation: receipt.generation } }
    }
    return { credentialId: row.credentialId, revision: Number(row.revision) }
  }
  async execute(context: ConfigurationContext): Promise<Json> {
    await context.guard()
    const binding = (await this.db.query<Binding>('select * from application_registry_bindings where server_identity=$1', [context.server.id])).rows[0]
    if (!binding) return { error: 'binding_missing' }
    const credential = await this.credentials.read()
    const remove = !binding.active || binding.registry !== credential.registry || !credential.configured || context.server.typeKey !== TYPE || !binding.repositories.every(repo => inScope(repo, credential.repositories))
    const input = context.input as { mode?: string; image?: string; receipt?: { revision: number; configRevision: string; serverId: string } }
    if (input.mode === 'deploy') {
      const image = repositoryOf(input.image)
      if (!context.recovering && (remove || !input.receipt || credential.revision !== input.receipt.revision || context.server.configRevision !== input.receipt.configRevision || context.server.id !== input.receipt.serverId)) return { error: 'credential_receipt_stale' }
      if (!context.recovering && (image.registry !== credential.registry || !inScope(image.repository, binding.repositories))) return { error: 'image_scope_denied' }
      // The core job retains its server lease throughout pull, replacement and health checks.
      // Server edits, key rotations and credential jobs cannot run concurrently with this operation.
      let result: Json
      try {
        const remote = await context.exec('if [ "$(id -u)" -eq 0 ]; then /usr/local/sbin/ces-registry; else sudo -n /usr/local/sbin/ces-registry; fi', 1_230_000, {
          stdin: JSON.stringify({ action: context.recovering ? 'deployment-status' : 'deploy', image: input.image, receipt: input.receipt, operationId: context.operationId }), outputLimitBytes: 8192,
        })
        const parsed = JSON.parse(remote.stdout)
        const allowed = new Set(['credential_receipt_stale','credential_config_missing','registry_auth_failed','image_scope_denied','registry_permission_denied','image_pull_failed','deployment_runtime_missing','deployment_failed','server_busy','remote_timeout','registry_operation_failed','root_required','deployment_outcome_unknown','deployment_not_started'])
        if (parsed.pending === true || parsed.error === 'server_busy') return { pending: true }
        result = parsed.error ? { error: allowed.has(parsed.error) ? parsed.error : 'registry_operation_failed', pulled: parsed.pulled === true, deployed: false } : remote.code === 0 && parsed.pulled === true && parsed.deployed === true && parsed.image === input.image ? { pulled: true, deployed: true, image: String(input.image) } : { error: 'registry_operation_failed' }
      } catch { return { pending: true } }
      await context.guard()
      await context.commit(async db => {
        await db.query("update application_registry_requests set pull_result=$2,reported_at=now() where deployment_job_id=(select id from server_jobs where operation_id=$1)", [context.operationId, JSON.stringify({ ...(result as object), image: input.image, reportedBy: 'managed-server-job' })])
      })
      return result
    }
    const request = { action: remove ? 'remove' : 'prepare', serverId: context.server.id, configRevision: context.server.configRevision,
      credentialId: credential.id, revision: credential.revision, registry: credential.registry, repositories: binding.repositories,
      operationId: context.operationId, sequence: context.sequence, fence: context.fence }
    const source = Buffer.from(await this.source).toString('base64')
    const bootstrap = `import base64;s=base64.b64decode("${source}").decode();exec(compile(s,"ces-registry","exec"),{"__name__":"__main__","CES_SOURCE":s})`
    const python = `python3 -c '${bootstrap.replaceAll("'", "'\\''")}'`
    const command = `if [ "$(id -u)" -eq 0 ]; then ${python}; else sudo -n ${python}; fi`
    const call = async (value: unknown): Promise<Record<string, unknown>> => {
      await context.guard()
      const remote = await context.exec(command, 120_000, { stdin: JSON.stringify(value), outputLimitBytes: 8192 })
      let result: Record<string, unknown>
      try { result = JSON.parse(remote.stdout) } catch { return { error: 'registry_operation_failed' } }
      if (result.error) return { error: remoteErrors.has(String(result.error)) ? String(result.error) : 'registry_operation_failed' }
      if (remote.code !== 0) return { error: 'registry_operation_failed' }
      if (result.needsCredentials === true) return { needsCredentials: true }
      if (remove && result.removed === true) return { removed: true }
      const receipt = result.receipt as Record<string, unknown> | undefined
      if (!receipt || receipt.serverId !== request.serverId || receipt.credentialId !== credential.id || receipt.revision !== credential.revision || receipt.configRevision !== request.configRevision || typeof receipt.generation !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(receipt.generation)) return { error: 'registry_operation_failed' }
      return { receipt: { serverId: receipt.serverId, credentialId: receipt.credentialId, revision: receipt.revision, configRevision: receipt.configRevision, generation: receipt.generation }, reused: result.reused === true }
    }
    let result: Record<string, unknown>
    try {
      result = await call(request)
      if (result.needsCredentials) {
        const resolved = await this.credentials.resolve(credential.id, credential.revision)
        result = await call({ ...request, username: resolved.username, password: resolved.password })
      }
    } catch {
      // Raw errors can include SSH command/input or docker output. Never persist them.
      result = { error: 'registry_operation_failed' }
    }
    const latest = await this.credentials.read()
    await context.commit(async db => {
      if (result.error) {
        await db.query(`update application_registry_bindings set state=case when active then 'failed' else 'cleanup_pending' end,last_error=$2,retry_at=now()+interval '60 seconds',updated_at=now() where server_identity=$1`, [context.server.id, result.error])
      } else if (remove) {
        await db.query("update application_registry_bindings set active=false,state='removed',applied_revision=null,generation=null,last_error=null,updated_at=now() where server_identity=$1", [context.server.id])
      } else {
        const receipt = result.receipt as { generation: string }
        await db.query(`update application_registry_bindings set applied_revision=$2,desired_revision=$3,generation=$4,config_revision=$5,state=case when active and $2::bigint=$3::bigint then 'synced' when active then 'pending' else 'cleanup_pending' end,last_error=null,updated_at=now() where server_identity=$1`, [context.server.id, credential.revision, latest.revision, receipt.generation, context.server.configRevision])
      }
    })
    if (remove && !result.error) return { removed: true }
    return result as Json
  }
}
