import { fileURLToPath } from 'node:url'
import type {
  DefinitionBundle,
  RecipeDefinition,
  Registration,
  ScriptDefinition,
} from '@smp/console-server-management/contracts'

const owner = '@smp/console-self-evolution'
const runtime = '@smp/console-container-runtime'
const docker = `${runtime}/docker-engine`
const dockerRecipe = `${runtime}/docker-engine-apt`
const compose = `${runtime}/docker-compose`
const composeRecipe = `${runtime}/docker-compose-apt`
const postgresql = `${owner}/postgresql`
const postgresqlRecipe = `${owner}/postgresql-docker`
const onedev = `${owner}/onedev`
const onedevRecipe = `${owner}/onedev-docker`
const caddy = `${owner}/caddy`
const caddyRecipe = `${owner}/caddy-docker`
const buildAgent = `${owner}/onedev-build-agent`
const cesHost = `${owner}/ces-host`
const supportedOs = [{ family: 'builtin/ubuntu', versions: { kind: 'release' as const, version: '24.04' }, architectures: ['x86_64', 'aarch64'] }]
const script: ScriptDefinition = {
  path: fileURLToPath(new URL('../scripts/stack.sh', import.meta.url)),
  interpreter: 'posix-sh',
  timeoutMs: 900_000,
  outputLimitBytes: 1_048_576,
}
const testScript: ScriptDefinition = {
  path: fileURLToPath(new URL('../scripts/test.sh', import.meta.url)),
  interpreter: 'posix-sh',
  timeoutMs: 900_000,
  outputLimitBytes: 1_048_576,
}
const hostScript: ScriptDefinition = {
  path: fileURLToPath(new URL('../scripts/host.sh', import.meta.url)),
  interpreter: 'posix-sh',
  timeoutMs: 900_000,
  outputLimitBytes: 1_048_576,
}
const recipeWith = (source: ScriptDefinition, key: string, software: string, requires: RecipeDefinition['requires'] = []): RecipeDefinition => ({
  key,
  software,
  supportedOs,
  requires,
  detect: source,
  listCandidates: source,
  resolve: source,
  mutation: { actions: ['install', 'upgrade', 'replace'], execute: source, verify: source, recover: source },
})
const recipe = (key: string, software: string, requires: RecipeDefinition['requires'] = []): RecipeDefinition =>
  recipeWith(script, key, software, requires)
const testRecipe = (key: string, software: string, requires: RecipeDefinition['requires'] = []): RecipeDefinition =>
  recipeWith(testScript, key, software, requires)
const hostRecipe = (key: string, software: string, requires: RecipeDefinition['requires'] = []): RecipeDefinition =>
  recipeWith(hostScript, key, software, requires)
const infrastructureType = `${owner}/infrastructure`
const testType = `${owner}/test`
const hostType = `${owner}/host`

export const selfEvolutionDefinitions: DefinitionBundle = {
  contractVersion: 2,
  owner,
  software: [
    { key: 'postgresql', name: { zh: 'PostgreSQL', en: 'PostgreSQL' }, versions: 'semver-stable' },
    { key: 'onedev', name: { zh: 'OneDev', en: 'OneDev' }, versions: 'semver-stable' },
    { key: 'caddy', name: { zh: 'Caddy', en: 'Caddy' }, versions: 'semver-stable' },
    { key: 'onedev-build-agent', name: { zh: 'OneDev 构建 Agent', en: 'OneDev build agent' }, versions: 'semver-stable' },
    { key: 'ces-host', name: { zh: 'CES 部署接收端', en: 'CES deploy target' }, versions: 'semver-stable' },
  ],
  recipes: [
    recipe('postgresql-docker', postgresql, [{ software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] }]),
    recipe('onedev-docker', onedev, [
      { software: postgresql, versions: { kind: 'any' }, recipes: [postgresqlRecipe] },
      { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
    ]),
    recipe('caddy-docker', caddy, [{ software: onedev, versions: { kind: 'any' }, recipes: [onedevRecipe] }]),
    testRecipe('postgresql-test-docker', postgresql, [
      { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
      { software: compose, versions: { kind: 'any' }, recipes: [composeRecipe] },
    ]),
    testRecipe('caddy-test-docker', caddy, [
      { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
      { software: compose, versions: { kind: 'any' }, recipes: [composeRecipe] },
      { software: postgresql, versions: { kind: 'any' }, recipes: [`${owner}/postgresql-test-docker`] },
    ]),
    testRecipe('onedev-build-agent-test', buildAgent, [
      { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
      { software: compose, versions: { kind: 'any' }, recipes: [composeRecipe] },
    ]),
    hostRecipe('postgresql-prod-docker', postgresql, [
      { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
      { software: compose, versions: { kind: 'any' }, recipes: [composeRecipe] },
    ]),
    hostRecipe('caddy-prod-docker', caddy, [
      { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
      { software: compose, versions: { kind: 'any' }, recipes: [composeRecipe] },
      { software: postgresql, versions: { kind: 'any' }, recipes: [`${owner}/postgresql-prod-docker`] },
    ]),
    hostRecipe('ces-host-bootstrap', cesHost),
  ],
  types: [
    {
      key: 'infrastructure',
      name: { zh: '自演进基础设施服务器', en: 'Self-evolution infrastructure server' },
      supportedOs: { kind: 'explicit', selectors: supportedOs },
      requirements: [
        { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
        { software: postgresql, versions: { kind: 'any' }, recipes: [postgresqlRecipe] },
        { software: onedev, versions: { kind: 'any' }, recipes: [onedevRecipe] },
        { software: caddy, versions: { kind: 'any' }, recipes: [caddyRecipe] },
      ],
    },
    {
      key: 'test',
      name: { zh: '自演进测试服务器', en: 'Self-evolution test server' },
      supportedOs: { kind: 'explicit', selectors: supportedOs },
      requirements: [
        { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
        { software: compose, versions: { kind: 'any' }, recipes: [composeRecipe] },
        { software: postgresql, versions: { kind: 'any' }, recipes: [`${owner}/postgresql-test-docker`] },
        { software: caddy, versions: { kind: 'any' }, recipes: [`${owner}/caddy-test-docker`] },
        { software: buildAgent, versions: { kind: 'any' }, recipes: [`${owner}/onedev-build-agent-test`] },
      ],
    },
    {
      key: 'host',
      name: { zh: '自演进宿主服务器', en: 'Self-evolution host server' },
      supportedOs: { kind: 'explicit', selectors: supportedOs },
      requirements: [
        { software: docker, versions: { kind: 'any' }, recipes: [dockerRecipe] },
        { software: compose, versions: { kind: 'any' }, recipes: [composeRecipe] },
        { software: postgresql, versions: { kind: 'any' }, recipes: [`${owner}/postgresql-prod-docker`] },
        { software: caddy, versions: { kind: 'any' }, recipes: [`${owner}/caddy-prod-docker`] },
        { software: cesHost, versions: { kind: 'any' }, recipes: [`${owner}/ces-host-bootstrap`] },
      ],
    },
  ],
  groups: [
    {
      key: 'self-evolution',
      name: { zh: '自演进组', en: 'Self-evolution' },
      order: 10,
      types: [infrastructureType, testType, hostType],
      defaultType: infrastructureType,
    },
  ],
}

interface Ctx {
  serverManagement: {
    registerDefinitions(definition: DefinitionBundle): Registration
  }
  containerRuntime: { ready: Promise<void> }
}

export const inject = ['serverManagement', 'containerRuntime']

export async function apply(ctx: Ctx): Promise<void> {
  await ctx.containerRuntime.ready
  const registration = ctx.serverManagement.registerDefinitions(selfEvolutionDefinitions)
  await registration.ready
}
