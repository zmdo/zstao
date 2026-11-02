import type { readChangePlan } from '../changes/service.ts'

const show = (id: string) => ({
  tool: 'platform_server_upgrade_admin',
  arguments: { action: 'show', input: { plan_id: id } },
})

export function draftResult(planId: string, kind: 'move' | 'upgrade', fullAccess = false) {
  return {
    plan_id: planId,
    kind,
    state: 'draft',
    requires_approval: !fullAccess,
    guidance:
      'Only a draft was created. Preflight runs asynchronously. After a short delay, call next_step until ready, review changes, then call apply to execute. Full access skips approval; other permission modes request user approval. Do not report the requested server change as completed yet.',
    next_step: show(planId),
  }
}

export function planResult(plan: Awaited<ReturnType<typeof readChangePlan>>) {
  const current = { ...plan, revision: String(plan.revision) }
  if (
    plan.state === 'awaiting_confirmation' &&
    plan.targets.every((target) => target.preflight_state === 'ready')
  ) {
    return {
      ...current,
      guidance:
        'Review targets[].target_snapshot.changes and risks. Complete next_step.arguments.input with a maintenance window consistent with user intent, then call apply; the host executes directly under full access and requests user approval in other permission modes. This plan has not executed. Do not invent revision/digest or self-approval fields.',
      next_step: {
        tool: 'platform_server_upgrade_admin',
        arguments: {
          action: 'apply',
          input: {
            plan_id: plan.id,
            revision: current.revision,
            review_digest: plan.review_digest,
          },
        },
        required_input: ['start', 'end', 'timezone'],
      },
    }
  }
  if (['draft', 'scheduled', 'running'].includes(plan.state))
    return {
      ...current,
      guidance:
        plan.state === 'draft'
          ? 'Preflight is pending. Wait briefly and call show again; inspect preflight_error if blocked. No server changes have executed yet.'
          : 'Execution is pending or running. Wait and call show again, respecting window_start/window_end. Do not re-apply or claim success before state=completed and all targets succeeded.',
      next_step: show(plan.id),
    }
  if (plan.state === 'completed' && plan.targets.every((target) => target.state === 'succeeded'))
    return {
      ...current,
      guidance:
        'Plan succeeded. Verify current group/type/software with platform_server_get and summarize the actual result.',
      next_step: { tool: 'platform_server_get', arguments: { server: plan.targets[0]!.server_id } },
    }
  return {
    ...current,
    next_step: null,
    guidance:
      'Inspect targets[].preflight_error and result and report the actual state. blocked/partial_failure/paused/missed/cancelled are not success; do not retry apply blindly. Running work may finish after cancellation; no automatic rollback. Get current server state before choosing a new plan.',
  }
}
