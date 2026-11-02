import { AdminRuntime } from './host/admin/runtime.ts'
import { localePreference, type LocaleSettingsReader } from './host/admin/download-copy.ts'
import { registerWorkspaceAdminTools } from './host/admin/workspace-tools.ts'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Db } from './host/database/connection.ts'
import { builtinCatalog } from './host/definitions/catalog.ts'
import { DefinitionRegistry } from './host/definitions/registry.ts'
import { ServerManagement } from './host/definitions/service.ts'
import { ServerExtensionRegistry } from './host/extensions/registry.ts'
import { startJobs } from './host/execution/runtime.ts'
import { registerRoutes } from './host/http/routes.ts'
import { connectSsh } from './host/remote/ssh.ts'
import { terminalRoute } from './host/remote/terminal.ts'
import { Enrollment } from './host/servers/enrollment.ts'
import { startMetrics } from './host/servers/metrics.ts'
import { enqueueExisting } from './host/servers/service.ts'
import { registerServerTools } from './host/harness/tools.ts'
import { loadExecLimits } from './host/harness/settings-service.ts'
import { DEFAULT_EXEC_LIMITS } from './host/harness/exec.ts'
import { registerServerOpsGroup, type WorkspaceGroupsService } from './host/workspace-group.ts'

export { ServerManagement } from './host/definitions/service.ts'
export type { LocalizedText } from './shared/contracts/common.ts'
export type {
  DefinitionBundle,
  PublicTypeContribution,
  RecipeDefinition,
  Registration,
  ScriptDefinition,
  ServerManagementContract,
  ServerTypeDefinition,
  SoftwareDefinition,
  SoftwareRequirement,
  SystemGroupDefinition,
} from './shared/contracts/definitions.ts'
export type { RecipeRequest, RecipeResponse } from './shared/contracts/recipes.ts'
export type { ServerExtensionRuntime } from './host/extensions/runtime.ts'
export type {
  ExtensionCatalogEntry,
  ExtensionInspection,
  ExtensionKind,
  ExtensionPanel,
  ExtensionQuery,
  ExtensionScope,
  ExtensionSettingsSection,
  ServerExtensionBundle,
} from './shared/contracts/extensions.ts'
export { VACANT_TYPE } from './shared/definitions.ts'
export type {
  DeclaredOs,
  DetectedOs,
  OsSelector,
  OsSupport,
  ProbedOs,
} from './shared/operating-system-types.ts'
export type { VersionAdapter, VersionRule } from './shared/versions.ts'

interface SessionService {
  read(cookieHeader: string): Promise<unknown>
}

interface HostCtx extends Context {
  database: { pool: Db }
  consoleSession: SessionService
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
    registerUpgrade(route: {
      path: string
      handler: (
        request: IncomingMessage,
        socket: import('node:stream').Duplex,
        head: Buffer,
      ) => void | Promise<void>
    }): () => void
  }
}

export interface Config {
  inspectIntervalSeconds: number
  metricsIntervalSeconds: number
  sshReadyTimeoutSeconds: number
  updateCheckIntervalSeconds: number
  harnessExecDefaultTimeoutMs: number
  harnessExecMaxTimeoutMs: number
  harnessExecDefaultCommandBytes: number
  harnessExecMaxCommandBytes: number
  harnessExecDefaultOutputBytes: number
  harnessExecMaxOutputBytes: number
}

export const Config: Schema<Config> = Schema.object({
  inspectIntervalSeconds: Schema.number().default(30),
  metricsIntervalSeconds: Schema.number().default(1),
  updateCheckIntervalSeconds: Schema.natural().min(60).max(604800).default(3600),
  sshReadyTimeoutSeconds: Schema.natural().min(1).max(300).default(30),
  harnessExecDefaultTimeoutMs: Schema.natural().min(1000).max(120000).default(30000),
  harnessExecMaxTimeoutMs: Schema.natural().min(1000).max(120000).default(120000),
  harnessExecDefaultCommandBytes: Schema.natural().min(1024).max(65536).default(8192),
  harnessExecMaxCommandBytes: Schema.natural().min(1024).max(65536).default(65536),
  harnessExecDefaultOutputBytes: Schema.natural().min(1024).max(1048576).default(65536),
  harnessExecMaxOutputBytes: Schema.natural().min(1024).max(1048576).default(1048576),
})

export const inject = ['webServer', 'database', 'secrets', 'consoleSession']

/** Routes, the job loop, inspection, and metric sampling live in this process. */
export async function* apply(ctx: HostCtx, config: Config): AsyncGenerator<() => void | Promise<void>> {
  const catalog = builtinCatalog()
  const db = ctx.database.pool
  ctx.inject(['workspaceGroups'], (child: Context & { workspaceGroups: WorkspaceGroupsService }) => {
    void registerServerOpsGroup(child.workspaceGroups).catch((cause: unknown) => ctx.logger.warn(cause))
  })
  const definitions = new DefinitionRegistry(db, catalog)
  const extensions = new ServerExtensionRegistry(definitions)
  const connect: typeof connectSsh = (input) =>
    connectSsh({ ...input, readyTimeoutMs: config.sshReadyTimeoutSeconds * 1000 })
  const enrollment = new Enrollment({ db, secrets: ctx.secrets, definitions }, connect)
  const configuredExecLimits = {
    defaultTimeoutMs: config.harnessExecDefaultTimeoutMs,
    maxTimeoutMs: config.harnessExecMaxTimeoutMs,
    defaultCommandBytes: config.harnessExecDefaultCommandBytes,
    maxCommandBytes: config.harnessExecMaxCommandBytes,
    defaultOutputBytes: config.harnessExecDefaultOutputBytes,
    maxOutputBytes: config.harnessExecMaxOutputBytes,
    rsyncDeniedFlags: DEFAULT_EXEC_LIMITS.rsyncDeniedFlags,
  }
  if (configuredExecLimits.defaultTimeoutMs > configuredExecLimits.maxTimeoutMs || configuredExecLimits.defaultCommandBytes > configuredExecLimits.maxCommandBytes || configuredExecLimits.defaultOutputBytes > configuredExecLimits.maxOutputBytes)
    throw new Error('harness execution defaults exceed their maximum limits')
  const execLimits = await loadExecLimits(db, configuredExecLimits)
  const deps = {
    localePreference: () => localePreference(ctx.get('settings') as LocaleSettingsReader | undefined),
    db,
    secrets: ctx.secrets,
    catalog,
    definitions,
    extensions,
    enrollment,
    updateCheckIntervalSeconds: config.updateCheckIntervalSeconds,
    connect,
    execLimits,
    freshnessMs: Math.max(90, config.inspectIntervalSeconds * 3) * 1000,
  }
  const admin = new AdminRuntime(deps)
  ctx.inject(['tools'], (scope) => {
    registerServerTools(scope, deps)
  })
  ctx.inject(['tools', 'agents', 'systemPrompt', 'workspaceGroups'], (scope: Context & { workspaceGroups: WorkspaceGroupsService }) =>
    registerWorkspaceAdminTools(scope, admin, scope.workspaceGroups),
  )
  yield ctx.effect(function* () {
    yield () => definitions.close()
    yield () => extensions.close()
    yield startJobs(ctx, db, config, definitions, connect, extensions)
    yield startMetrics(
      db,
      ctx.secrets,
      config.metricsIntervalSeconds,
      (cause) => {
        ctx.logger.error(cause)
      },
      connect,
      (serverId) => enqueueExisting(deps, serverId, 'test_connection', 'scheduled'),
    )
    yield () => enrollment.close()
    admin.start((cause) => ctx.logger.error(cause))
    yield () => admin.close()
    yield* registerRoutes(ctx, { ...deps, adminRun: (work) => admin.run(work) })
    const terminal = terminalRoute(db, ctx.secrets, ctx.consoleSession, connect)
    yield ctx.webServer.registerUpgrade({ path: '/console-api/servers/terminal', handler: terminal.handler })
    yield () => terminal.close()
    yield ctx.provide('serverManagement', new ServerManagement(ctx, definitions, extensions))
  })
}
