import { digest } from '../recipes/canonical.ts'
import { lockCatalog } from '../groups/persistence/catalog-lock.ts'
import { transaction } from '../database/transaction.ts'
import type { Db } from '../database/connection.ts'
import type { AdminContext, AdminDeps } from './model.ts'
import { AdminError } from './model.ts'
import { account, audit } from './persistence/repository.ts'
import { describeApproval } from './approval-copy.ts'
import { authorizeOperation } from '../harness/authorization.ts'
export async function approve(
  deps: Pick<AdminDeps, 'db' | 'definitions' | 'catalog'>,
  ctx: AdminContext,
  tool: string,
  action: string,
  target: string,
  preview: unknown,
) {
  const { db } = deps
  if (!ctx.agent) throw new AdminError('unauthorized')
  const actor = await account(db)
  // Authorization belongs to this call; a reused context cannot carry a prior grant.
  ctx.authorization = undefined
  const decision = await authorizeOperation(ctx, ctx.approval, async () => {
    const summary = JSON.stringify({ action, target, preview })
    if (summary.length > 48000) throw new AdminError('approval_preview_too_large')
    const displayReason = await describeApproval(deps, tool, action, target, preview)
    if (Object.values(displayReason).some((text) => text.length > 48000))
      throw new AdminError('approval_preview_too_large')
    return { toolName: tool, reason: displayReason.en, displayReason }
  })
  if (!decision.allowed || ctx.signal.aborted) {
    await audit(db, {
      tool,
      action,
      target,
      before: preview,
      status: 'denied',
      actor,
      context: ctx,
      approval: 'denied',
    })
    throw new AdminError('approval_denied')
  }
  ctx.authorization = decision.authorization
  return actor
}
export async function mutate<T>(
  deps: Pick<AdminDeps, 'db' | 'definitions' | 'catalog'>,
  ctx: AdminContext,
  tool: string,
  action: string,
  target: string,
  read: (db: Db, lock: boolean) => Promise<unknown>,
  run: (db: Db) => Promise<T>,
  parameters: unknown,
) {
  const { db } = deps
  const before = await read(db, false)
  const actor = await approve(deps, ctx, tool, action, target, { before, parameters })
  try {
    return await transaction(db, async (client) => {
      if (ctx.signal.aborted) throw new AdminError('cancelled')
      // Match the catalog lock ordering used by server edits and group deletion.
      await lockCatalog(client)
      const current = await read(client, true)
      if (digest(before) !== digest(current)) throw new AdminError('server_revision_conflict')
      if (ctx.signal.aborted) throw new AdminError('cancelled')
      const result = await run(client)
      if (ctx.signal.aborted) throw new AdminError('cancelled')
      await audit(client, {
        tool,
        action,
        target,
        before,
        after: result,
        parameters,
        status: 'succeeded',
        actor,
        context: ctx,
        approval: 'approved',
      })
      return result
    })
  } catch (cause) {
    await audit(db, {
      tool,
      action,
      target,
      before,
      after: { code: cause instanceof AdminError ? cause.code : 'operation_failed' },
      parameters,
      status: 'failed',
      actor,
      context: ctx,
      approval: 'approved',
    })
    throw cause
  }
}
