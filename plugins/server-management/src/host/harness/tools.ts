import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { execParameters, getParameters, groupListParameters, listParameters, rsyncParameters, TEXT_OUTPUT } from './schema.ts'
import { DEFAULT_EXEC_LIMITS } from './exec.ts'
import { executeHarnessCommand, type ApprovalRequester } from './exec.ts'
import { harnessTrace } from './trace.ts'
import { getHarnessServer, listHarnessGroups, listHarnessServers, type HarnessDeps } from './service.ts'
import { executeHarnessRsync } from './rsync.ts'
import { sessionPermission } from './authorization.ts'

const LIST_DESCRIPTION =
  'List servers managed by this platform. Only servers returned by this tool are managed. ' +
  'Never assume localhost, an IP address or an SSH target is managed.'

const GET_DESCRIPTION =
  'Read status, operating system, software and resource observations for one managed server. ' +
  'Also returns id, config_revision, group_id, type_key, ssh_key_id and unfinished key_rotations. Read fresh config_revision before administrative changes; use these returned IDs rather than guessing. ' +
  'The server argument must be a managed server id or exact server name; never pass an arbitrary SSH host.'

export function registerServerTools(ctx: Context, deps: HarnessDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'platform_server_list',
      description: LIST_DESCRIPTION,
      parameters: listParameters,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args) {
        return JSON.stringify(await listHarnessServers(deps, args))
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'platform_server_group_list',
      description:
        'List groups available for filtering managed servers. ' +
        'Use a returned group id or exact name with platform_server_list.',
      parameters: groupListParameters,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args) {
        return JSON.stringify(await listHarnessGroups(deps, args))
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'platform_server_exec',
      description:
        'Run a command on one managed server through the platform SSH credentials. ' +
        'The server argument must be a managed server id or exact name; never pass an arbitrary SSH host. ' +
        'With the host full-access permission preset, execute directly; otherwise request user approval. Every execution is audited.',
      parameters: execParameters(deps.execLimits ?? DEFAULT_EXEC_LIMITS),
      output: TEXT_OUTPUT,
      timeoutMs: 300_000,
      async execute(args, exec) {
        const trace = harnessTrace(exec.agent, String(exec.callId), ctx.get('sessionProjections') as never)
        return executeHarnessCommand(
          deps,
          args,
          {
            agent: exec.agent,
            callId: String(exec.callId),
            rootCallId: String(exec.rootCallId),
            signal: exec.signal,
            permission: sessionPermission(ctx, exec.agent),
            harnessTurn: trace.turn,
            harnessStep: trace.step,
            harnessEventSeq: trace.eventSeq,
          },
          ctx.get('approval') as ApprovalRequester | undefined,
        )
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'platform_server_rsync',
      description:
        'Run a complete rsync command line against one managed server. ' +
        'The command must begin with rsync, contain a remote host belonging to the selected server, and pass the configured denied-flag policy. ' +
        'With the host full-access permission preset, transfer directly; otherwise request user approval. Every transfer is audited.',
      parameters: rsyncParameters,
      output: TEXT_OUTPUT,
      timeoutMs: 600_000,
      async execute(args, exec) {
        const directories = ctx.get('workingDirectory') as { ensure(agent: unknown, signal?: AbortSignal): Promise<string> } | undefined
        const workspace = directories === undefined || exec.agent === undefined
          ? undefined
          : await directories.ensure(exec.agent, exec.signal)
        const trace = harnessTrace(exec.agent, String(exec.callId), ctx.get('sessionProjections') as never)
        return executeHarnessRsync(
          deps,
          args,
          { agent: exec.agent, callId: String(exec.callId), rootCallId: String(exec.rootCallId), signal: exec.signal, permission: sessionPermission(ctx, exec.agent), harnessTurn: trace.turn, harnessStep: trace.step, harnessEventSeq: trace.eventSeq },
          ctx.get('approval') as ApprovalRequester | undefined,
          workspace,
        )
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'platform_server_get',
      description: GET_DESCRIPTION,
      parameters: getParameters,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args) {
        return JSON.stringify(await getHarnessServer(deps, args.server))
      },
    }),
  )
}
