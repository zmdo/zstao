import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SERVER_OPS_GROUP } from '../workspace-group.ts'
import { AdminError } from './model.ts'
import type { AdminRuntime } from './runtime.ts'

interface WorkspaceGroups {
  groupForSession(id: string): Promise<string | undefined>
}

/** Tool ownership follows the session's workspace, independently of the selected sidebar group. */
export async function registerWorkspaceAdminTools(
  ctx: Context,
  runtime: AdminRuntime,
  groups: WorkspaceGroups,
): Promise<void> {
  const registrations = new Map<Agent, () => void>()
  const disposed = new WeakSet<Agent>()
  const pending = new Set<Promise<boolean>>()
  let closed = false

  const allowed = async (agent: Agent | undefined) =>
    agent !== undefined && await groups.groupForSession(agent.id) === SERVER_OPS_GROUP.id
  const checkWorkspace = async (agent: Agent | undefined) => {
    if (!await allowed(agent)) throw new AdminError('server_ops_workspace_required')
  }
  const release = (agent: Agent) => {
    registrations.get(agent)?.()
    registrations.delete(agent)
  }
  const refresh = (agent: Agent): Promise<boolean> => {
    if (closed || disposed.has(agent)) return Promise.resolve(false)
    const task = (async () => {
      const enabled = await allowed(agent)
      if (closed || disposed.has(agent)) return false
      if (enabled === registrations.has(agent)) return false
      if (enabled) registrations.set(agent, runtime.registerForAgent(agent, checkWorkspace))
      else release(agent)
      return true
    })()
    pending.add(task)
    return task.finally(() => { pending.delete(task) })
  }

  ctx.effect(() => async () => {
    closed = true
    await Promise.allSettled([...pending])
    for (const agent of registrations.keys()) release(agent)
  })
  ctx.on('agent/created', async ({ agent }) => { await refresh(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    disposed.add(agent)
    release(agent)
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const changed = context.agent === undefined ? false : await refresh(context.agent)
    const result = await next()
    // Providers have already materialized native schemas and the PTC SDK before this hook.
    // Reassemble once after a registration change so both representations use the same scope.
    return changed && !closed ? ctx.systemPrompt.assemble(context) : result
  })
  await Promise.all(ctx.agents.list().map(refresh))
}
