import { fileURLToPath } from 'node:url'
import type { DefinitionBundle, ScriptDefinition } from '@smp/console-server-management/contracts'
import type { ServerExtensionBundle } from '@smp/console-server-management/contracts'
import type { ServerExtensionRuntime } from '@smp/console-server-management/contracts'
import type { Db, ServerManagementHostContract } from '@smp/console-server-management/contracts'
import { parseContainers, type Container } from './model.ts'
import { containerSnapshot, replaceContainers, requireContainerSchema } from './persistence/containers.ts'
import { APT_SOFTWARE_OS } from './operating-systems.ts'

const owner = '@smp/console-server-containers'
const runtime = '@smp/console-container-runtime'
const docker = `${runtime}/docker-engine`
const compose = `${runtime}/docker-compose`
const type = `${owner}/container`
const inspectScript: ScriptDefinition = {
  path: fileURLToPath(new URL('../scripts/inspect.sh', import.meta.url)),
  interpreter: 'posix-sh',
  timeoutMs: 30_000,
  outputLimitBytes: 65_536,
}
export const containerDefinitions: DefinitionBundle = {
  contractVersion: 2,
  owner,
  types: [
    {
      key: 'container',
      name: { zh: '容器服务器', en: 'Container server' },
      supportedOs: { kind: 'explicit', selectors: APT_SOFTWARE_OS },
      requirements: [
        { software: docker, versions: { kind: 'any' }, recipes: [`${runtime}/docker-engine-apt`] },
        { software: compose, versions: { kind: 'any' }, recipes: [`${runtime}/docker-compose-apt`] },
      ],
    },
  ],
  publicTypes: [{ type, order: 10 }],
}

export const containerExtensions: ServerExtensionBundle = {
  contractVersion: 1,
  owner,
  panels: [
    {
      key: 'containers',
      name: { zh: '容器', en: 'Containers' },
      appliesTo: { types: [type] },
    },
  ],
  queries: [
    {
      key: 'container-list',
      name: { zh: '容器清单', en: 'Container list' },
      appliesTo: { types: [type] },
    },
  ],
  settings: [
    {
      key: 'container-settings', revision: '1',
      name: { zh: '容器设置', en: 'Container settings' },
      appliesTo: { types: [type] },
    },
  ],
  inspections: [
    {
      key: 'container-check',
      name: { zh: '容器检查', en: 'Container check' },
      appliesTo: { types: [type] },
      settingsKey: `${owner}/container-settings`,
      script: inspectScript,
    },
  ],
}

const extensionHandlers: ServerExtensionRuntime = {
  inspections: {
    'container-check': {
      enabled: (value) => (value as { collect?: boolean } | undefined)?.collect !== false,
      validate: parseContainers,
      async commit(db, server, result) {
        await replaceContainers(db, server.id, (result as { containers: Container[] }).containers)
      },
    },
  },
  settings: {
    'container-settings': {
      defaults: { collect: true },
      validate(value) {
        if (value === null || typeof value !== 'object' || typeof (value as { collect?: unknown }).collect !== 'boolean')
          throw new Error('invalid container settings')
        return { collect: (value as { collect: boolean }).collect }
      },
    },
  },
}

interface Ctx {
  database: { pool: Pick<Db, 'query'> }
  serverManagement: ServerManagementHostContract
  containerRuntime: { ready: Promise<void> }
}

export const inject = ['serverManagement', 'database', 'containerRuntime']

export async function apply(ctx: Ctx): Promise<void> {
  await requireContainerSchema(ctx.database.pool)
  await ctx.containerRuntime.ready
  const definitionsReady = ctx.serverManagement.registerDefinitions(containerDefinitions)
  await definitionsReady.ready
  const extensionRuntime: ServerExtensionRuntime = {
    ...extensionHandlers,
    queries: {
      'container-list': async (server) => ({ ...await containerSnapshot(ctx.database.pool, server.id) }),
    },
  }
  const extensionsReady = ctx.serverManagement.registerServerExtensions(containerExtensions, extensionRuntime)
  await extensionsReady.ready
}
