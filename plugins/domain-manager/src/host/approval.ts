import type { Context } from '@deepseek-ai/cordis'

export interface ApprovalRequester {
  request(input: {
    toolName: string
    kind: string
    reason: string
    displayReason: string
    agent: unknown
    callId: string
    signal: AbortSignal
  }): Promise<string>
}

export interface SessionPermission {
  preset: string | undefined
  mode: string | undefined
}

export interface ApprovalDetails {
  toolName: string
  kind: string
  reason: string
  displayReason: string
}

export type Decision = { allowed: true; source: 'full-access' | 'user-approval' } | { allowed: false; outcome: string }

interface PermissionPresets {
  current(session: unknown): string
}

interface SandboxPolicy {
  resolve(input: { session: unknown }): { mode: string }
}

/** Read live permission state for the calling session, never tool arguments. */
export function sessionPermission(ctx: Context, agent: { session?: unknown } | undefined): () => SessionPermission {
  return () => {
    if (agent?.session === undefined) return { preset: undefined, mode: undefined }
    const presets = ctx.get('permissionPresets') as PermissionPresets | undefined
    const policy = ctx.get('sandboxPolicy') as SandboxPolicy | undefined
    return {
      preset: presets?.current(agent.session),
      mode: policy?.resolve({ session: agent.session }).mode,
    }
  }
}

/**
 * Full access is standing authorization; every other session must approve each
 * DNS change. A missing or failing approval channel never grants permission.
 */
export async function authorizeOperation(
  ctx: Context,
  exec: { agent: unknown; callId: string; signal: AbortSignal; permission: () => SessionPermission },
  describe: () => ApprovalDetails,
): Promise<Decision> {
  if (exec.signal.aborted) return { allowed: false, outcome: 'cancelled' }
  if (exec.agent === undefined) return { allowed: false, outcome: 'unavailable' }
  const permission = exec.permission()
  if (permission.preset === 'danger-full-access' && permission.mode === 'danger-full-access') {
    return { allowed: true, source: 'full-access' }
  }
  const approval = ctx.get('approval') as ApprovalRequester | undefined
  if (approval === undefined) return { allowed: false, outcome: 'unavailable' }
  let outcome: string
  try {
    outcome = await approval.request({
      ...describe(),
      agent: exec.agent,
      callId: exec.callId,
      signal: exec.signal,
    })
  } catch {
    return { allowed: false, outcome: 'unavailable' }
  }
  if (exec.signal.aborted) return { allowed: false, outcome: 'cancelled' }
  return outcome === 'allowed-once' ? { allowed: true, source: 'user-approval' } : { allowed: false, outcome }
}
