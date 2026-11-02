import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { sessionPermission } from '../../src/host/harness/authorization.ts'
import type { ExecContext } from '../../src/host/harness/exec.ts'

export async function permissionFixture(t: TestContext) {
  const ctx = new Context()
  const owners = [
    await ctx.plugin((scope: Context) => {
      new SessionStore(scope as never)
    }),
    await ctx.plugin(SessionProjections),
  ]
  owners.push(await ctx.plugin(SandboxPolicy, { mode: 'workspace-write' }))
  owners.push(await ctx.plugin(ApprovalService))
  owners.push(
    await ctx.plugin((scope: Context) => {
      scope.provide('shell', { sandboxMode: 'workspace-write' } as never)
    }),
  )
  owners.push(await ctx.plugin(PermissionPresets))
  owners.push(await ctx.plugin(SystemPrompt), await ctx.plugin(ToolRuntime))
  const session = Session.create(SessionId(randomUUID()))
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session } as Agent
  owners.push(
    await ctx.plugin(
      Object.assign(
        (scope: Context) => {
          Object.assign(agent, { ctx: createScope(scope as never, agent).ctx })
        },
        { inject: ['tools', 'systemPrompt'] },
      ),
    ),
  )
  let prompts = 0
  let answer: ApprovalOutcome = 'allowed-once'
  owners.push(
    await ctx.plugin((scope: Context) => {
      scope.on('approval/request', async () => {
        prompts++
        return answer
      })
    }),
  )
  t.after(async () => {
    for (const owner of owners.reverse()) await owner.dispose()
  })
  const exec = (): ExecContext => ({
    agent,
    callId: randomUUID(),
    signal: new AbortController().signal,
    permission: sessionPermission(ctx, agent),
  })
  return {
    ctx,
    agent,
    session,
    exec,
    prompts: () => prompts,
    set: (preset: string) => ctx.permissionPresets.set(session, preset),
    answer: (next: ApprovalOutcome) => {
      answer = next
    },
  }
}
