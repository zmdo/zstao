import { randomUUID } from 'node:crypto'
import type { PreparedPlan } from '../../shared/changes.ts'
import { type ChangeRequest } from '../../shared/changes.ts'
import { ServerError } from '../../shared/errors.ts'
import type { Db } from '../database/connection.ts'
import { digest } from '../recipes/canonical.ts'
import { type ServerSecret } from '../servers/persistence/rows.ts'
import { owned } from './ownership.ts'
import * as repository from './persistence/repository.ts'
import type { JobRecord } from './persistence/rows.ts'

export async function savePlan(
  db: Db,
  job: JobRecord,
  server: ServerSecret,
  plan: PreparedPlan,
): Promise<void> {
  await owned(db, job, async (client) => {
    const current = (await repository.serverRevision(client, server.id)).rows[0]!
    if (String(current.config_revision) !== String(server.config_revision))
      throw new ServerError('job_configuration_changed')
    if ((await repository.findPlan(client, job.id)).rows.length) return
    const id = job.id,
      target = randomUUID(),
      child = randomUUID()
    const window = { start: new Date().toISOString(), end: new Date(Date.now() + 15 * 60_000).toISOString() }
    const confirmation = {
      plan,
      serverId: server.id,
      configRevision: String(server.config_revision),
      environmentRevision: String(server.environment_revision),
      window,
      concurrency: 1,
    }
    const fingerprint = digest(confirmation)
    await repository.insertPreparation(client, {
      id,
      fingerprint,
      authorization:
        job.request_snapshot.action === 'install_components'
          ? 'authenticated-install-request'
          : 'saved-install-choice',
      start: window.start,
      end: window.end,
      snapshot: JSON.stringify(confirmation),
    })
    await repository.insertPreparedTarget(client, {
      id: target,
      planId: id,
      serverId: server.id,
      snapshot: JSON.stringify({ host: server.host, port: server.ssh_port }),
      configRevision: server.config_revision,
      environmentRevision: server.environment_revision,
      definitionRevision: plan.definitionRevision,
      plan: JSON.stringify(plan),
    })
    await repository.insertApplyJob(client, {
      id: child,
      serverId: server.id,
      targetId: target,
      configRevision: server.config_revision,
      environmentRevision: server.environment_revision,
      definitionRevision: plan.definitionRevision,
      operationId: randomUUID(),
      snapshot: JSON.stringify({ action: 'install_components', planId: id, digest: fingerprint }),
    })
  })
}

export async function loadPlan(
  db: Db,
  job: JobRecord,
  beginMutation = false,
): Promise<{ plan: PreparedPlan; digest: string; request?: ChangeRequest } | undefined> {
  return owned(db, job, async (client) => {
    const row = (
      await repository.acceptedPlan(client, {
        targetId: job.target_id,
        serverId: job.server_id,
        configRevision: job.expected_config_revision,
        definitionRevision: job.definition_revision,
      })
    ).rows[0]
    if (
      !row ||
      digest(row.request_snapshot) !== row.confirmation_digest ||
      job.request_snapshot.digest !== row.confirmation_digest
    )
      return
    const frozen =
      row.request_snapshot.targets?.find((t) => t.id === job.target_id)?.plan ?? row.request_snapshot.plan
    if (!frozen || digest(frozen) !== digest(row.target_snapshot)) return
    if (!job.mutation_phase) {
      if (
        !['scheduled', 'running'].includes(row.state) ||
        row.window_start.getTime() > Date.now() ||
        row.window_end.getTime() <= Date.now()
      )
        return
    }
    if (beginMutation) {
      const phase = row.target_snapshot.changes.some((c) => c.action === 'replace')
        ? 'replacing'
        : row.target_snapshot.changes.some((c) => c.action === 'upgrade')
          ? 'upgrading'
          : 'installing'
      await repository.beginMutation(client, job.id, phase)
      await repository.startTarget(client, job.target_id)
      await repository.startPlan(client, job.target_id)
      job.mutation_phase = phase
    }
    return { plan: row.target_snapshot, digest: row.confirmation_digest, request: row.request_snapshot }
  })
}
