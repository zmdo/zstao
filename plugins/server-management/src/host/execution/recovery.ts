import { randomUUID } from 'node:crypto'
import { type PreparedPlan } from '../../shared/changes.ts'
import { ServerError } from '../../shared/errors.ts'
import { type Db } from '../database/connection.ts'
import { canonical } from '../recipes/canonical.ts'
import { validObservation } from '../recipes/protocol.ts'
import { remoteOperation, type RemoteResult } from '../remote/operation.ts'
import { scrub, scrubValue } from '../remote/parse.ts'
import { type SshSession } from '../remote/ssh.ts'
import { saveComponentStatus } from '../servers/persistence/observation-repository.ts'
import { finishJob } from './completion.ts'
import { owned, recovering } from './ownership.ts'
import * as repository from './persistence/result-repository.ts'
import { type JobRecord } from './persistence/rows.ts'
import { loadPlan } from './plans.ts'

export async function reconcile(
  db: Db,
  job: JobRecord,
  result: RemoteResult,
  secret: string,
  plan: PreparedPlan,
): Promise<void> {
  if (result.state === 'not-started') {
    await finishJob(db, job, 'failed', '远端安装未启动；可重新检查并准备新计划。', {
      summary: 'not_started',
      steps: [],
    })
    return
  }
  if (result.state !== 'completed' && result.state !== 'failed') {
    await recovering(
      db,
      job,
      result.state === 'running' ? '远端安装仍在进行。' : '远端结果尚不能确定，已保留服务器执行锁。',
      result.state === 'running' ? 'running' : 'unknown',
    )
    return
  }
  for (const step of result.steps) {
    const change = plan.changes[step.ordinal - 1]
    if (
      !change ||
      change.software !== step.software ||
      (step.after !== undefined && !validObservation(step.after))
    )
      throw new ServerError('recipe_protocol')
  }
  if (
    result.state === 'completed' &&
    (result.steps.length !== plan.changes.length ||
      new Set(result.steps.map((step) => step.ordinal)).size !== plan.changes.length ||
      result.steps.some((step) => {
        const change = plan.changes[step.ordinal - 1]!,
          actual = step.after
        if (step.state !== 'succeeded' || !validObservation(actual)) return true
        if (change.action === 'keep' || change.action === 'defer-install')
          return canonical(actual) !== canonical(change.before)
        return (
          actual.state !== 'installed' ||
          !actual.healthy ||
          actual.targetIdentity !== change.target?.targetIdentity
        )
      }))
  )
    throw new ServerError('recipe_protocol')
  const cleaned = {
    ...scrubValue(result, secret),
    ...(result.state === 'completed'
      ? {
          summary:
            job.request_snapshot.action === 'upgrade_software'
              ? 'upgraded'
              : job.request_snapshot.action === 'move_server'
                ? 'moved'
                : 'installed',
        }
      : {}),
  } as RemoteResult
  await owned(db, job, async (client) => {
    for (const step of cleaned.steps) {
      const change = plan.changes[step.ordinal - 1]!
      if (validObservation(step.after))
        await saveComponentStatus(
          client,
          job.server_id,
          {
            [step.software]: {
              ...step.after,
              installed: step.after.state === 'installed',
              detail: 'detail' in step.after ? (step.after.detail ?? '') : '',
              revision: change.recipeRevision,
            },
          },
          [
            {
              id: step.software,
              software_key: step.software,
              recipe: change.recipe,
            },
          ],
        )
    }
    for (const step of cleaned.steps)
      await repository.saveStep(client, {
        id: randomUUID(),
        jobId: job.id,
        ordinal: step.ordinal,
        software: step.software,
        state: step.state === 'succeeded' ? 'succeeded' : 'failed',
        after: JSON.stringify(step.after ?? null),
        changes: JSON.stringify(step.changes),
        error: result.error ? JSON.stringify({ message: scrub(result.error, secret) }) : null,
        phase: job.mutation_phase ?? 'installing',
      })
  })
  await finishJob(
    db,
    job,
    result.state === 'completed' ? 'succeeded' : 'failed',
    result.state === 'completed'
      ? '已完成安装并验证。'
      : scrub(result.error ?? '安装失败；请查看已发生的远端变化。', secret),
    cleaned,
  )
}

export async function recoverMutation(
  db: Db,
  job: JobRecord,
  session: SshSession,
  secret: string,
): Promise<void> {
  const saved = await loadPlan(db, job)
  if (!saved) {
    await recovering(db, job, '安装计划不可用，需要人工核对远端操作。')
    return
  }
  const result = await remoteOperation(session, 'recover', job.operation_id, saved.digest)
  await reconcile(db, job, result, secret, saved.plan)
}
