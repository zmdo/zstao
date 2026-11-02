import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { ApprovalRequester, ExecContext } from './exec.ts'

export interface SessionPermission {
  preset: string | undefined
  mode: string | undefined
}
interface PermissionPresets {
  current(session: Agent['session']): string
}
export interface Authorization {
  source: 'full-access' | 'user-approval'
  permissionMode?: string
}
type Decision =
  | { allowed: true; authorization: Authorization }
  | { allowed: false; outcome: string }
type ApprovalDetails = Pick<
  Parameters<ApprovalRequester['request']>[0],
  'toolName' | 'kind' | 'reason' | 'displayReason'
>

/** Read live host state for the calling session, never tool arguments or UI selection. */
export function sessionPermission(ctx: Context, agent: Agent | undefined): () => SessionPermission {
  return () => {
    if (!agent?.session) return { preset: undefined, mode: undefined }
    const presets = ctx.get('permissionPresets') as PermissionPresets | undefined
    const policy = ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
    return {
      preset: presets?.current(agent.session),
      mode: policy?.resolve({ session: agent.session }).mode,
    }
  }
}

export async function authorizeOperation(
  exec: ExecContext,
  approval: ApprovalRequester | undefined,
  describe: () => ApprovalDetails | Promise<ApprovalDetails>,
): Promise<Decision> {
  if (exec.signal.aborted) return { allowed: false, outcome: 'cancelled' }
  if (!exec.agent) return { allowed: false, outcome: 'unavailable' }
  const permission = exec.permission?.()
  // Auto can also use an unrestricted sandbox. Only the host's full-access preset
  // grants standing authorization for these server operations.
  if (permission?.preset === 'danger-full-access' && permission.mode === 'danger-full-access')
    return {
      allowed: true,
      authorization: { source: 'full-access', permissionMode: permission.mode },
    }
  if (!approval) return { allowed: false, outcome: 'unavailable' }
  const details = await describe()
  if (exec.signal.aborted) return { allowed: false, outcome: 'cancelled' }
  let outcome: string
  try {
    outcome = await approval.request({
      ...details,
      agent: exec.agent,
      callId: exec.callId,
      signal: exec.signal,
    })
  } catch (cause) {
    // An unavailable approval channel never grants authorization.
    void cause
    return { allowed: false, outcome: 'unavailable' }
  }
  if (exec.signal.aborted) return { allowed: false, outcome: 'cancelled' }
  return outcome === 'allowed-once'
    ? {
        allowed: true,
        authorization: { source: 'user-approval', permissionMode: permission?.mode },
      }
    : { allowed: false, outcome }
}
