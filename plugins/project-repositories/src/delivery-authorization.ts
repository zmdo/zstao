import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ApiError } from './onedev.ts'

interface Services { get?(name: string): unknown }
interface Presets { current(session: unknown): string }
interface Policy { resolve(input: { session: unknown }): { mode: string } }
interface Approval { request(input: { agent: NonNullable<ToolRunContext['agent']>; callId: string; signal: AbortSignal; toolName: string; reason: string; displayReason: { en: string; zh: string } }): Promise<string> }

export async function authorizeBuild(ctx: Services, exec: ToolRunContext, project: string, job: string, commit: string): Promise<void> {
  return authorizeProjectOperation(ctx, exec, `Run OneDev job ${project}/${job} at ${commit}`, `运行 OneDev 构建 ${project}/${job}（${commit.slice(0, 12)}）？`)
}

export async function authorizeProjectOperation(ctx: Services, exec: ToolRunContext, reason: string, chineseReason: string): Promise<void> {
  exec.signal.throwIfAborted()
  if (!exec.agent?.session) throw new ApiError(403, 'approval_unavailable')
  const presets = ctx.get?.('permissionPresets') as Presets | undefined
  const policy = ctx.get?.('sandboxPolicy') as Policy | undefined
  if (presets?.current(exec.agent.session) === 'danger-full-access' && policy?.resolve({ session: exec.agent.session }).mode === 'danger-full-access') return
  const approval = ctx.get?.('approval') as Approval | undefined
  if (!approval) throw new ApiError(403, 'approval_unavailable')
  const outcome = await approval.request({ agent: exec.agent, callId: exec.callId, signal: exec.signal, toolName: 'platform_onedev', reason,
    displayReason: { en: reason, zh: chineseReason } })
  exec.signal.throwIfAborted()
  if (outcome !== 'allowed-once') throw new ApiError(403, 'approval_denied')
}
