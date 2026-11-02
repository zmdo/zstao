import { ServerError } from '../../../shared/errors.ts'
import { canonical } from '../../recipes/canonical.ts'
import { checkPlan } from '../../recipes/planning.ts'
import { detectSoftware } from '../../recipes/software.ts'
import { remoteOperation, type RemoteResult } from '../../remote/operation.ts'
import { scrubValue } from '../../remote/parse.ts'
import { saveComponentStatus } from '../../servers/persistence/observation-repository.ts'
import type { WorkerContext } from '../context.ts'
import { owned, phase } from '../ownership.ts'
import { loadPlan } from '../plans.ts'
import { reconcile } from '../recovery.ts'

export async function applyPlanJob(context: WorkerContext): Promise<void> {
  const { db, job, server, lease, probe, secret, guard, state } = context
  let { session } = context

  const saved = await loadPlan(db, job)
  if (
    !saved ||
    !lease ||
    probe.state !== 'detected' ||
    canonical(saved.plan.os) !== canonical(probe.os) ||
    String(server.environment_revision) !== String(job.expected_environment_revision)
  )
    throw new ServerError('plan_conflict')
  await checkPlan(session, lease, saved.plan)
  await guard()
  const admitted = await loadPlan(db, job, true)
  if (!admitted) throw new ServerError('plan_not_ready')
  state.mutation = true
  const changing = saved.plan.changes.some((c) => ['install', 'upgrade', 'replace'].includes(c.action))
  let result: RemoteResult = changing
    ? await remoteOperation(session, 'start', job.operation_id, saved.digest, saved.plan, lease)
    : {
        state: 'completed',
        steps: saved.plan.changes.map((change, index) => ({
          ordinal: index + 1,
          software: change.software,
          state: 'succeeded',
          changes: [],
          after: change.before,
        })),
      }
  while (result.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await guard()
    result = await remoteOperation(session, 'recover', job.operation_id, saved.digest)
  }
  if (context.reconnect) session = await context.reconnect()
  await phase(db, job, 'verifying')
  const actual = await detectSoftware(session, lease.components, probe.os)
  await owned(db, job, (client) =>
    saveComponentStatus(client, server.id, scrubValue(actual, secret), lease.components),
  )
  await reconcile(db, job, result, secret, saved.plan)
}
