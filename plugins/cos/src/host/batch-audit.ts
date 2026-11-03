import type { Queryable } from './config.ts'
import { recordAudit } from './audit.ts'
import type { BatchOutcome, BatchPlan } from './batch.ts'

export interface BatchAuditInput {
  actor: 'console' | 'tool'
  sessionId: string | null
  plan: BatchPlan
  outcome: BatchOutcome
}

/**
 * One row per changed object plus a summary row. Skipped and cancelled items
 * are deliberately not written: they did not change the bucket.
 */
export async function recordBatchAudit(pool: Queryable, input: BatchAuditInput): Promise<void> {
  for (const item of input.outcome.items) {
    if (item.status === 'skipped_conflict' || item.status === 'skipped_missing' || item.status === 'cancelled') continue
    const key = item.to ?? item.key ?? item.from ?? ''
    await recordAudit(pool, {
      sessionId: input.sessionId,
      actor: input.actor,
      action: item.op,
      objectKey: key,
      sizeBytes: item.size,
      ok: item.status === 'ok',
      error: item.status === 'ok' ? null : item.code ?? item.status,
      detail: {
        batchId: input.outcome.batchId,
        from: item.from ?? null,
        to: item.to ?? null,
        status: item.status,
        detail: item.detail ?? null,
      },
    })
  }
  const summary = input.outcome.summary
  await recordAudit(pool, {
    sessionId: input.sessionId,
    actor: input.actor,
    action: 'batch',
    objectKey: '',
    sizeBytes: null,
    ok: summary.failed === 0 && summary.sourceKept === 0 && summary.cancelled === 0,
    error: null,
    detail: {
      batchId: input.outcome.batchId,
      requested: input.plan.summary.requested,
      conflicts: input.plan.summary.conflicts,
      summary,
    },
  })
}
