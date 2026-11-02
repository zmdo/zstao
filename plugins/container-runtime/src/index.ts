import { Service, type Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import type {
  DefinitionBundle,
  RecipeDefinition,
  Registration,
  ScriptDefinition,
} from '@smp/console-server-management/contracts'
import type { ServerManagementHostContract } from '@smp/console-server-management/contracts'

const owner = '@smp/console-container-runtime'
export const dockerEngine = `${owner}/docker-engine`
export const dockerCompose = `${owner}/docker-compose`
export const dockerEngineRecipe = `${owner}/docker-engine-apt`
export const dockerComposeRecipe = `${owner}/docker-compose-apt`

const script: ScriptDefinition = {
  path: fileURLToPath(new URL('../scripts/recipe.sh', import.meta.url)),
  interpreter: 'posix-sh',
  timeoutMs: 600_000,
  outputLimitBytes: 1_048_576,
}

const recipe = (key: string, software: string): RecipeDefinition => ({
  key,
  software,
  supportedOs: [
    ...['22.04', '24.04'].map((version) => ({
      family: 'builtin/ubuntu',
      versions: { kind: 'release' as const, version },
      architectures: ['x86_64', 'aarch64'],
    })),
    ...['12', '13'].map((prefix) => ({
      family: 'builtin/debian',
      versions: { kind: 'series' as const, prefix },
      architectures: ['x86_64', 'aarch64'],
    })),
  ],
  detect: script,
  listCandidates: script,
  resolve: script,
  mutation: {
    actions: ['install', 'upgrade', 'replace'],
    execute: script,
    verify: script,
    recover: script,
  },
})

export const containerRuntimeDefinitions: DefinitionBundle = {
  contractVersion: 2,
  owner,
  software: [
    { key: 'docker-engine', name: { zh: 'Docker Engine', en: 'Docker Engine' }, versions: 'semver-stable' },
    { key: 'docker-compose', name: { zh: 'Docker Compose', en: 'Docker Compose' }, versions: 'semver-stable' },
  ],
  recipes: [
    recipe('docker-engine-apt', dockerEngine),
    recipe('docker-compose-apt', dockerCompose),
  ],
}

export class ContainerRuntime extends Service {
  readonly ready: Promise<void>

  constructor(ctx: Context, ready: Promise<void>) {
    super(ctx, 'containerRuntime')
    this.ready = ready
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    containerRuntime: ContainerRuntime
  }
}

interface Ctx extends Context {
  serverManagement: ServerManagementHostContract
}

export const inject = ['serverManagement']

export async function apply(ctx: Ctx): Promise<void> {
  const registration: Registration = ctx.serverManagement.registerDefinitions(containerRuntimeDefinitions)
  new ContainerRuntime(ctx, registration.ready)
  await registration.ready
}
