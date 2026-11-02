import { fileURLToPath } from 'node:url'
import type { DefinitionBundle } from '@smp/console-server-management/contracts'
import type { ServerExtensionBundle } from '@smp/console-server-management/contracts'
import type { ServerExtensionRuntime } from '@smp/console-server-management/contracts'
import type { ServerDto } from '@smp/console-server-management/contracts'

export const fixtureType = '@test/extension-fixture/database'

export const fixtureDefinitions: DefinitionBundle = {
  contractVersion: 2,
  owner: '@test/extension-fixture',
  types: [
    {
      key: 'database',
      name: { zh: '数据库服务器', en: 'Database server' },
      supportedOs: { kind: 'all' },
      requirements: [],
    },
  ],
  publicTypes: [{ type: fixtureType, order: 10 }],
}

export const fixtureExtension: ServerExtensionBundle = {
  contractVersion: 1,
  owner: '@test/extension-fixture',
  panels: [
    {
      key: 'database-panel',
      name: { zh: '数据库管理', en: 'Database management' },
      appliesTo: { types: [fixtureType] },
    },
  ],
  settings: [
    {
      key: 'database-settings', revision: '1',
      name: { zh: '数据库设置', en: 'Database settings' },
      appliesTo: { types: [fixtureType] },
    },
  ],
  queries: [
    {
      key: 'database-status',
      name: { zh: '数据库状态', en: 'Database status' },
      appliesTo: { types: [fixtureType] },
    },
  ],
  inspections: [
    {
      key: 'database-check',
      name: { zh: '数据库检查', en: 'Database check' },
      appliesTo: { types: [fixtureType] },
      settingsKey: '@test/extension-fixture/database-settings',
      script: {
        path: fileURLToPath(new URL('./inspection.sh', import.meta.url)),
        interpreter: 'posix-sh',
        timeoutMs: 1000,
        outputLimitBytes: 4096,
      },
    },
  ],
}

export const fixtureRuntime: ServerExtensionRuntime = {
  queries: {
    'database-status': async () => ({ online: true }),
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
  },
}
