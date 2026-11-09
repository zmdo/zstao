import { Service, type Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RegistryCredentials } from '@smp/console-project-repositories/contracts'
import { RegistryManager } from './registry.ts'
import { API, registryHandler } from './http.ts'
import type { ConfigurationHostContract, Db } from '@smp/console-server-management/contracts'
import type { DefinitionBundle, Registration } from '@smp/console-server-management/contracts'

const owner = '@smp/console-application-server'
export const applicationServerType = `${owner}/application-server`
const dockerEngine = '@smp/console-container-runtime/docker-engine'
const dockerCompose = '@smp/console-container-runtime/docker-compose'
const dockerEngineRecipe = '@smp/console-container-runtime/docker-engine-apt'
const dockerComposeRecipe = '@smp/console-container-runtime/docker-compose-apt'

const ubuntu = ['22.04', '24.04'].map(version => ({
  family: 'builtin/ubuntu',
  versions: { kind: 'release' as const, version },
  architectures: ['x86_64', 'aarch64'],
}))
const debian = ['12', '13'].map(prefix => ({
  family: 'builtin/debian',
  versions: { kind: 'series' as const, prefix },
  architectures: ['x86_64', 'aarch64'],
}))

export const applicationServerDefinitions: DefinitionBundle = {
  contractVersion: 2,
  owner,
  types: [{
    key: 'application-server',
    name: { zh: '应用服务器', en: 'Application server' },
    supportedOs: { kind: 'explicit', selectors: [...ubuntu, ...debian] },
    requirements: [
      { software: dockerEngine, versions: { kind: 'any' }, recipes: [dockerEngineRecipe] },
      { software: dockerCompose, versions: { kind: 'any' }, recipes: [dockerComposeRecipe] },
    ],
  }],
  publicTypes: [{ type: applicationServerType, order: 20 }],
}

export class ApplicationServer extends Service {
  readonly ready: Promise<void>
  constructor(ctx: Context, ready: Promise<void>) {
    super(ctx, 'applicationServer')
    this.ready = ready
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    applicationServer: ApplicationServer
  }
}

interface Ctx extends Context {
  serverManagement: { registerDefinitions(definition: DefinitionBundle): Registration } & ConfigurationHostContract
  containerRuntime: { ready: Promise<void> }
  registryCredentials: RegistryCredentials
  database: { pool: Db }
  consoleSession: { read(cookie: string): Promise<unknown> }
  webServer: { register(route: { kind: 'prefix'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }
}

export const inject = ['serverManagement', 'containerRuntime', 'registryCredentials', 'database', 'webServer', 'consoleSession']

export async function apply(ctx: Ctx): Promise<void> {
  await ctx.containerRuntime.ready
  const registration = ctx.serverManagement.registerDefinitions(applicationServerDefinitions)
  await registration.ready
  const manager = new RegistryManager(ctx.database.pool, ctx.registryCredentials, ctx.serverManagement)
  const operation = ctx.serverManagement.registerConfigurationOperation({
    owner, key: 'registry-credentials', validate: input => manager.validate(input), execute: context => manager.execute(context),
  })
  await operation.ready
  ctx.effect(() => {
    let closed = false
    let reconciling: Promise<void> | undefined
    const pending = new Set<Promise<void>>()
    const reconcile = () => {
      if (closed || reconciling) return
      reconciling = manager.reconcile().catch(() => { ctx.logger.warn('Registry credential reconciliation failed; it will retry.') }).finally(() => { reconciling = undefined })
    }
    const timer = setInterval(reconcile, 30_000)
    reconcile()
    const handler = registryHandler(ctx, ctx.database.pool, manager)
    const stop = ctx.webServer.register({ kind: 'prefix', path: API, handler(request, response) {
      const task = handler(request, response).finally(() => pending.delete(task))
      pending.add(task)
      return task
    } })
    return async () => {
      closed = true; clearInterval(timer); stop()
      await Promise.allSettled([...pending, ...(reconciling ? [reconciling] : [])])
    }
  })
  new ApplicationServer(ctx, Promise.resolve())
}
