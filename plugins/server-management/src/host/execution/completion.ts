import { ServerError } from '../../shared/errors.ts'
import { errorPayload } from '../../shared/i18n.ts'
import { commitBinding, finishPreflight } from '../changes/service.ts'
import type { Db } from '../database/connection.ts'
import { savepoint } from '../database/transaction.ts'
import { owned } from './ownership.ts'
import * as repository from './persistence/repository.ts'
import type { JobRecord } from './persistence/rows.ts'

export async function finishJob(
  db: Db,
  job: JobRecord,
  state: 'succeeded' | 'failed' | 'blocked',
  message: string,
  result: unknown = null,
): Promise<void> {
  await owned(db, job, async (client) => {
    await repository.finish(client, {
      id: job.id,
      state,
      message: message.slice(-4000),
      result: JSON.stringify(result),
    })
    if (
      job.purpose === 'inspect' &&
      job.request_snapshot.action === 'inspect' &&
      !job.request_snapshot.prepare &&
      (job.request_snapshot.source === undefined || job.request_snapshot.source === 'scheduled')
    ) {
      await repository.reportInspection(client, job.id)
    }
    if (job.purpose === 'detect_updates' && state !== 'succeeded') {
      await repository.failDetection(client, {
        serverId: job.server_id,
        result: JSON.stringify(result ?? { message }),
        intervalSeconds: job.request_snapshot.intervalSeconds ?? 3600,
      })
    }
    if (job.target_id && job.purpose !== 'apply_plan') await finishPreflight(client, job, state, result)
    if (job.target_id && job.purpose === 'apply_plan') {
      if (state === 'succeeded') {
        const target = (await repository.targetSnapshot(client, job.target_id)).rows[0]
        try {
          await savepoint(client, 'binding_commit', () =>
            commitBinding(client, job, target?.target_snapshot.targetType),
          )
        } catch (cause) {
          state = 'failed'
          const error = errorPayload(new ServerError('binding_commit_failed', {}, { cause }))
          result = {
            ...(result && typeof result === 'object' ? result : {}),
            summary: 'binding_failed',
            error,
          }
          await repository.failBinding(client, {
            id: job.id,
            state,
            result: JSON.stringify(result),
            message: error.detail,
          })
        }
        if (state === 'succeeded') await repository.satisfySuggestions(client, job.server_id, job.target_id)
      }
      const target = (
        await repository.finishTarget(client, {
          targetId: job.target_id,
          state,
          result: JSON.stringify(result),
        })
      ).rows[0]!
      const parent = (await repository.lockPlanState(client, target.plan_id)).rows[0]!
      const targets = (await repository.targetStates(client, target.plan_id)).rows
      const pending = targets.some((t) => ['pending', 'running'].includes(t.state)),
        failed = targets.some((t) => ['failed', 'blocked'].includes(t.state)),
        skipped = targets.some((t) => t.state === 'skipped')
      const next = ['cancelled', 'missed', 'paused'].includes(parent.state)
        ? parent.state
        : state !== 'succeeded' && pending
          ? 'paused'
          : pending
            ? 'running'
            : skipped
              ? 'missed'
              : failed
                ? 'partial_failure'
                : 'completed'
      await repository.setPlanState(client, target.plan_id, next)
    }
  })
}
