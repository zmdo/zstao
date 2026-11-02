import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TEXT_OUTPUT } from '../harness/schema.ts'
import { harnessTrace } from '../harness/trace.ts'
import { sessionPermission } from '../harness/authorization.ts'
import type { ApprovalRequester } from '../harness/exec.ts'
import { executeAdmin } from './service.ts'
import { ADMIN_ACTIONS, adminDescription, adminParameters, type AdminTool } from './contracts.ts'
import { AdminError, object, type AdminDeps } from './model.ts'
import { scheduledRetention } from './retention.ts'
export class AdminRuntime {
  private controller = new AbortController()
  private pending = new Set<Promise<unknown>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private deps: AdminDeps
  constructor(deps: AdminDeps) {
    this.deps = deps
  }
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controller.signal.aborted) return Promise.reject(new AdminError('cancelled'))
    const promise = work(this.controller.signal)
    this.pending.add(promise)
    // The original promise carries failures to the caller; this observer only owns cleanup.
    void promise
      .finally(() => this.pending.delete(promise))
      .catch((cause) => {
        void cause
      })
    return promise
  }
  start(log: (cause: unknown) => void) {
    let running = false
    this.timer = setInterval(() => {
      if (running) return
      running = true
      void this.run((signal) => scheduledRetention(this.deps.db, signal))
        .catch(log)
        .finally(() => {
          running = false
        })
    }, 60000)
  }
  async close() {
    clearInterval(this.timer)
    this.controller.abort()
    await Promise.allSettled([...this.pending])
  }
  registerForAgent(
    agent: Agent,
    checkWorkspace: (agent: Agent | undefined) => Promise<void>,
  ): () => void {
    const ctx = agent.ctx
    // Use the active host registry's scope check: separate plugin installs may carry
    // different dsh-scope symbols. An empty restriction changes no tool visibility.
    const releaseScopeCheck = ctx.tools.restrict({ deny: [] })
    releaseScopeCheck()
    const disposers: (() => void)[] = []
    const dispose = () => {
      for (const release of disposers.splice(0).reverse()) release()
    }
    try {
      for (const name of Object.keys(ADMIN_ACTIONS) as AdminTool[]) {
        disposers.push(
          ctx.tools.register(
            defineTool({
              name,
              description: adminDescription(name),
              parameters: adminParameters(name),
              output: TEXT_OUTPUT,
              timeoutMs: 600000,
              execute: (args, exec) =>
                this.run(async (signal) => {
                  await checkWorkspace(exec.agent)
                  const input = object(args.input)
                  const trace = harnessTrace(
                    exec.agent,
                    String(exec.callId),
                    ctx.get('sessionProjections') as Parameters<typeof harnessTrace>[2],
                  )
                  const result = await executeAdmin(
                    this.deps,
                    {
                      agent: exec.agent,
                      callId: String(exec.callId),
                      rootCallId: String(exec.rootCallId),
                      signal: AbortSignal.any([signal, exec.signal]),
                    permission: sessionPermission(ctx, exec.agent),
                      approval: ctx.get('approval') as ApprovalRequester | undefined,
                      harnessTurn: trace.turn,
                      harnessStep: trace.step,
                      harnessEventSeq: trace.eventSeq,
                    },
                    name,
                    args.action as string,
                    input,
                  )
                  return JSON.stringify(result ?? { ok: true })
                }),
            }),
          ),
        )
      }
    } catch (cause) {
      dispose()
      throw cause
    }
    return dispose
  }
}
