import { type ChangeRequest } from '../../../shared/changes.ts'
import { ServerError } from '../../../shared/errors.ts'
import { savePreflight } from '../../changes/service.ts'
import { preparePlan } from '../../recipes/planning.ts'
import { finishJob } from '../completion.ts'
import type { WorkerContext } from '../context.ts'
import { owned } from '../ownership.ts'

export async function preflightJob(context: WorkerContext & { explicit: ChangeRequest }): Promise<void> {
  const { db, job, session, server, lease, probe, verified, explicit } = context

  if (!lease || probe.state !== 'detected' || verified !== 'matched') throw new ServerError('os_unverified')
  const plan = await preparePlan(session, lease, probe.os, {
    mode: explicit.selection.binding ? 'move' : 'upgrade',
    versions: explicit.selection.versions,
    installMissing: explicit.selection.binding?.installMissing,
  })
  if (explicit.selection.binding) plan.targetType = lease.type
  await owned(db, job, (c) => savePreflight(c, job, server, plan))
  await finishJob(db, job, 'succeeded', '预检完成，等待确认；未执行软件变更。', {
    summary: 'preflight_ready',
  })
}
