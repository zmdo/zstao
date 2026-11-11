import { setupApplicationServer } from './setup.ts'
import { openRestyVersions } from './versions.ts'
import { fileURLToPath } from 'node:url'
import type { ImageRegistryService } from '@smp/console-project-repositories/contracts'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { DefinitionBundle, DefinitionRuntime, Registration, ScriptDefinition } from '@smp/console-server-management/contracts'

const owner = '@smp/console-application-server'
export const applicationServerType = `${owner}/application-server`
export const openResty = `${owner}/openresty`
export const openRestyRecipe = `${owner}/openresty-docker`
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

const gatewayScript: ScriptDefinition = {
  path: fileURLToPath(new URL('../scripts/openresty.sh', import.meta.url)),
  interpreter: 'posix-sh',
  timeoutMs: 600_000,
  outputLimitBytes: 1_048_576,
}

export const applicationServerDefinitions: DefinitionBundle = {
  contractVersion: 2,
  owner,
  software: [{ key: 'openresty', name: { zh: 'OpenResty 网站网关', en: 'OpenResty web gateway' }, versions: openRestyVersions }],
  recipes: [{
    key: 'openresty-docker', software: openResty,
    supportedOs: [...ubuntu, ...debian],
    requires: [{ software: dockerEngine, versions: { kind: 'any' }, recipes: [dockerEngineRecipe] }],
    detect: gatewayScript, listCandidates: gatewayScript, resolve: gatewayScript,
    mutation: { actions: ['install', 'replace', 'upgrade'], execute: gatewayScript, verify: gatewayScript, recover: gatewayScript },
  }],
  types: [{
    key: 'application-server',
    requiresSetup: true,
    name: { zh: '应用服务器', en: 'Application server' },
    supportedOs: { kind: 'explicit', selectors: [...ubuntu, ...debian] },
    requirements: [
      { software: dockerEngine, versions: { kind: 'any' }, recipes: [dockerEngineRecipe] },
      { software: dockerCompose, versions: { kind: 'any' }, recipes: [dockerComposeRecipe] },
      { software: openResty, versions: { kind: 'any' }, recipes: [openRestyRecipe] },
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
  containerRuntime: { ready: Promise<void> }
  imageRegistry: ImageRegistryService
  serverManagement: { registerDefinitions(definition: DefinitionBundle, runtime?: DefinitionRuntime): Registration }
}

export const inject = ['serverManagement', 'containerRuntime', 'imageRegistry']

export async function apply(ctx: Ctx): Promise<void> {
  await ctx.containerRuntime.ready
  const registration = ctx.serverManagement.registerDefinitions(applicationServerDefinitions, {
    types: { 'application-server': context => setupApplicationServer(context, ctx.imageRegistry) },
  })
  new ApplicationServer(ctx, registration.ready)
  await registration.ready
}
