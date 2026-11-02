import type { DefinitionBundle, Registration } from '@smp/console-server-management/contracts'
import type { ServerExtensionBundle } from '@smp/console-server-management/contracts'
import type { ServerExtensionRuntime } from '@smp/console-server-management/contracts'
import { fileURLToPath } from 'node:url'

const owner = '@smp/console-server-extension-fixture'
const type = `${owner}/database`

const definitions: DefinitionBundle = {
  contractVersion: 2,
  owner,
  types: [
    {
      key: 'database',
      name: { zh: '数据库服务器', en: 'Database server' },
      supportedOs: { kind: 'all' },
      requirements: [],
    },
  ],
  publicTypes: [{ type, order: 10 }],
}

const extensions: ServerExtensionBundle = {
  contractVersion: 1,
  owner,
  panels: [
    {
      key: 'database-panel',
      name: { zh: '数据库管理', en: 'Database management' },
      appliesTo: { types: [type] },
    },
  ],
  settings: [
    {
      key: 'database-settings', revision: '1',
      name: { zh: '数据库设置', en: 'Database settings' },
      appliesTo: { types: [type] },
    },
    {
      key: 'database-execution', revision: '1',
      name: { zh: '数据库执行策略', en: 'Database execution policy' },
      appliesTo: { types: [type] },
      affectsExecution: true,
    },
  ],
  queries: [
    {
      key: 'database-status',
      name: { zh: '数据库状态', en: 'Database status' },
      appliesTo: { types: [type] },
    },
  ],
  inspections: [
    {
      key: 'database-check',
      name: { zh: '数据库检查', en: 'Database check' },
      appliesTo: { types: [type] },
      settingsKey: `${owner}/database-settings`,
      script: {
        path: fileURLToPath(new URL('../scripts/inspection.sh', import.meta.url)),
        interpreter: 'posix-sh',
        timeoutMs: 1000,
        outputLimitBytes: 4096,
      },
    },
  ],
}

const runtime: ServerExtensionRuntime = {
  queries: {
    'database-status': async (server) => ({ online: true, server: server.name }),
  },
  inspections: {
    'database-check': {
      enabled: (value) => (value as { collect?: boolean } | undefined)?.collect === true,
      validate: (raw) => JSON.parse(raw),
    },
  },
  settings: {
    'database-settings': {
      defaults: { collect: true },
      validate(value) {
        if (value === null || typeof value !== 'object' || typeof (value as { collect?: unknown }).collect !== 'boolean')
          throw new Error('invalid fixture settings')
        return value
      },
    },
    'database-execution': {
      defaults: { mode: 'observe' },
      validate(value) {
        if (value === null || typeof value !== 'object' || typeof (value as { mode?: unknown }).mode !== 'string')
          throw new Error('invalid fixture execution settings')
        return value
      },
    },
  },
}

interface FixtureCtx {
  serverManagement: {
    registerDefinitions(bundle: DefinitionBundle): Registration
    registerServerExtensions(bundle: ServerExtensionBundle, runtime?: ServerExtensionRuntime): Registration
  }
}

export const inject = ['serverManagement']

export async function apply(ctx: FixtureCtx): Promise<void> {
  const definitionsRegistration = ctx.serverManagement.registerDefinitions(definitions)
  await definitionsRegistration.ready
  const extensionsRegistration = ctx.serverManagement.registerServerExtensions(extensions, runtime)
  await extensionsRegistration.ready
}
