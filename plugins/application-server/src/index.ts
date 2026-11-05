import { Service, type Context } from '@deepseek-ai/cordis'
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
  serverManagement: { registerDefinitions(definition: DefinitionBundle): Registration }
}

export const inject = ['serverManagement']

export async function apply(ctx: Ctx): Promise<void> {
  const registration = ctx.serverManagement.registerDefinitions(applicationServerDefinitions)
  new ApplicationServer(ctx, registration.ready)
  await registration.ready
}
