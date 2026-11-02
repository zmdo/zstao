import { type ChangeRequest } from '../../shared/changes.ts'
import { typeSupportsOs } from '../../shared/definitions.ts'
import { ServerError } from '../../shared/errors.ts'
import { errorDetail, errorPayload } from '../../shared/i18n.ts'
import { osVerification } from '../../shared/operating-systems.ts'
import { preflightRequest } from '../changes/service.ts'
import { type Db } from '../database/connection.ts'
import { type TypeLease } from '../definitions/model.ts'
import { restrictLease } from '../definitions/policies.ts'
import { type DefinitionRegistry } from '../definitions/registry.ts'
import type { ServerExtensionRegistry } from '../extensions/registry.ts'
import { probeOs } from '../remote/os-probe.ts'
import { scrub, scrubValue } from '../remote/parse.ts'
import { connectSsh, type SshSession } from '../remote/ssh.ts'
import { probeInternalHost } from '../servers/internal-host.ts'
import { saveInternalHost } from '../servers/persistence/repository.ts'
import { serverSecret } from '../servers/persistence/credential-repository.ts'
import { markConnected, saveOsProbe } from '../servers/persistence/observation-repository.ts'
import { readPolicies } from '../servers/persistence/policy-repository.ts'
import { finishJob } from './completion.ts'
import type { WorkerContext } from './context.ts'
import { applyPlanJob } from './handlers/apply.ts'
import { detectUpdatesJob } from './handlers/detect.ts'
import { inspectJob } from './handlers/inspect.ts'
import { preflightJob } from './handlers/preflight.ts'
import { heartbeat, owned, phase, recovering } from './ownership.ts'
import * as repository from './persistence/result-repository.ts'
import { type JobRecord } from './persistence/rows.ts'
import { loadPlan } from './plans.ts'
import { recoverMutation } from './recovery.ts'

interface Secrets {
  decrypt(ciphertext: string): string
}

export async function executeJob(
  db: Db,
  secrets: Secrets,
  definitions: DefinitionRegistry,
  job: JobRecord,
  connect: typeof connectSsh = connectSsh,
  updateCheckIntervalSeconds = 3600,
  extensions?: ServerExtensionRegistry,
): Promise<void> {
  let session: SshSession | undefined,
    lease: TypeLease | undefined,
    secret = '',
    connected = false,
    leaseLost = false
  const state = { mutation: job.mutation_phase !== null }
  const heartbeats = new Set<Promise<void>>()
  const timer = setInterval(() => {
    const task = heartbeat(db, job)
      .then(
        (ok) => {
          if (!ok) leaseLost = true
        },
        () => {
          leaseLost = true
        },
      )
      .finally(() => heartbeats.delete(task))
    heartbeats.add(task)
  }, 15_000)
  const guard = async () => {
    if (leaseLost || !(await heartbeat(db, job))) throw new ServerError('job_lease_lost')
  }
  try {
    await guard()
    let server = await serverSecret(db, job.server_id)
    if (!server) throw new ServerError('server_not_found')
    if (String(server.config_revision) !== String(job.expected_config_revision))
      throw new ServerError('job_configuration_changed')
    secret = secrets.decrypt(server.secret_ciphertext)
    session = await connect({
      host: server.host,
      port: server.ssh_port,
      username: server.ssh_user,
      authMethod: server.auth_method,
      secret,
      expectedFingerprint: server.host_fingerprint,
    })
    connected = true
    await owned(db, job, (client) => markConnected(client, server!.id, session!.fingerprint))
    if (job.purpose === 'test_connection' || server.internal_host === null) {
      try {
        const internalHost = await probeInternalHost(session)
        if (internalHost !== null) {
          await saveInternalHost(db, server.id, internalHost)
          server.internal_host = internalHost
        }
      } catch {
        // Internal address is advisory; a failed probe must not fail the connection.
      }
    }
    // Recovery must remain possible when a provider has unloaded. The remote journal contains the accepted scripts and result.
    if (job.purpose === 'apply_plan' && job.state === 'recovering' && state.mutation) {
      await recoverMutation(db, job, session, secret)
      return
    }
    let explicit: ChangeRequest | undefined
    if (job.target_id && job.purpose !== 'apply_plan') explicit = await preflightRequest(db, job)
    if (job.purpose === 'apply_plan') {
      const accepted = await loadPlan(db, job)
      if (!accepted) throw new ServerError('plan_not_ready')
      explicit = accepted.request
    }
    const probe = await probeOs(session, server.declared_os)
    await owned(db, job, (client) => saveOsProbe(client, server!.id, probe, server!.config_revision))
    const verified = osVerification(
      server.declared_os,
      probe.state === 'detected' ? probe.os : null,
      probe.state,
    )
    if (verified === 'mismatch') throw new ServerError('os_mismatch')
    if (verified === 'custom' && (job.purpose === 'apply_plan' || job.request_snapshot.prepare)) throw new ServerError('os_unverified')
    lease = await definitions.lease(
      explicit?.selection?.binding ? explicit.selection.binding.groupId : server.group_id,
      explicit?.selection?.binding?.typeKey ?? server.type_key,
      probe.state === 'detected' ? probe.os : server.declared_os,
    )
    if (lease)
      lease = restrictLease(
        lease,
        explicit?.selection?.binding?.policies ?? (await readPolicies(db, server.id)),
      )
    if (job.purpose === 'apply_plan' || job.request_snapshot.prepare) {
      if (!lease) throw new ServerError('type_unavailable')
      if (job.definition_revision !== lease.signature) throw new ServerError('job_definition_changed')
    }
    if (lease?.components.length) {
      if (verified !== 'matched' || probe.state !== 'detected') throw new ServerError('os_unverified')
      if (!typeSupportsOs(lease.type, probe.os)) throw new ServerError('os_type_unsupported')
    }
    server = (await serverSecret(db, job.server_id))!
    await phase(db, job, 'preflight')
    const context: WorkerContext = {
      db,
      job,
      session,
      reconnect: async () => {
        try {
          await session?.close()
        } catch {
          // The upgrade may already have closed the old session.
        }
        session = await connect({
          host: server!.host,
          port: server!.ssh_port,
          username: server!.ssh_user,
          authMethod: server!.auth_method,
          secret,
          expectedFingerprint: server!.host_fingerprint,
        })
        return session
      },
      server,
      lease,
      probe,
      verified,
      explicit,
      secret,
      guard,
      state,
      updateCheckIntervalSeconds,
      extensions,
    }
    switch (job.purpose) {
      case 'detect_updates':
        await detectUpdatesJob(context)
        break
      case 'inspect':
        if (job.target_id && explicit) await preflightJob({ ...context, explicit })
        else await inspectJob(context)
        break
      case 'apply_plan':
        await applyPlanJob(context)
        break
      default:
        assertNever(job.purpose)
    }
  } catch (cause) {
    if (cause instanceof ServerError && cause.code === 'job_lease_lost') return
    const message = scrub(errorDetail(cause, '任务失败。'), secret)
    if (state.mutation) {
      const recoverable =
        cause instanceof ServerError &&
        cause.code === 'job_recovering' &&
        cause.params.operation === 'recover'
      if (!recoverable) {
        await finishJob(
          db,
          job,
          'failed',
          message,
          cause instanceof ServerError ? { error: scrubValue(errorPayload(cause), secret) } : null,
        )
        return
      }
      if (job.state === 'recovering' && job.recovery_attempts >= 2) {
        await finishJob(db, job, 'failed', message, { error: { code: 'recovery_exhausted' } })
        return
      }
      await recovering(db, job, message)
      return
    }
    if (!connected)
      await owned(db, job, (client) =>
        repository.markDisconnected(client, job.server_id, JSON.stringify({ message })).then(() => {}),
      )
    await finishJob(
      db,
      job,
      'failed',
      message,
      cause instanceof ServerError ? { error: scrubValue(errorPayload(cause), secret) } : null,
    )
  } finally {
    clearInterval(timer)
    await Promise.all(heartbeats)
    session?.close()
    lease?.release()
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported job purpose: ${value}`)
}
