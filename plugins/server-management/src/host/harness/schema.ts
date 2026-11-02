import type { ServerDisplayStatus } from '../../shared/server-status.ts'
import type { ExecLimits } from './exec.ts'

export const SERVER_STATUSES = [
  'unverified',
  'normal',
  'disconnected',
  'installing',
  'upgrading',
  'attention',
] as const satisfies readonly ServerDisplayStatus[]

export const listParameters = {
  query: {
    type: 'string',
    description: 'Optional words to match against managed server name, host, group, type or OS.',
  },
  status: {
    type: 'string',
    enum: SERVER_STATUSES,
    description: 'Optional platform display status filter.',
  },
  group: {
    type: 'string',
    description: 'Optional group id or exact group name.',
  },
  page: {
    type: 'integer',
    description: 'Page number, starting at 1. Defaults to 1.',
  },
  page_size: {
    type: 'integer',
    description: 'Number of servers per page, from 1 to 50. Defaults to 20.',
  },
} as const

export const getParameters = {
  server: {
    type: 'string',
    required: true,
    description: 'Managed server id, or its exact server name.',
  },
} as const

export function execParameters(limits: ExecLimits) {
  return {
    server: {
      type: 'string',
      required: true,
      description: 'Managed server id or exact server name.',
    },
    command: {
      type: 'string',
      required: true,
      description: `Shell command to run through the platform SSH credentials. Maximum ${limits.maxCommandBytes} bytes.`,
    },
    timeout_ms: {
      type: 'integer',
      description: `Execution timeout in milliseconds. Defaults to ${limits.defaultTimeoutMs}; maximum ${limits.maxTimeoutMs}.`,
    },
    command_max_bytes: {
      type: 'integer',
      description: `Optional command byte limit for this call. Defaults to ${limits.defaultCommandBytes}; maximum ${limits.maxCommandBytes}.`,
    },
    output_limit_bytes: {
      type: 'integer',
      description: `Optional captured-output byte limit for this call. Defaults to ${limits.defaultOutputBytes}; maximum ${limits.maxOutputBytes}.`,
    },
  } as const
}

export const groupListParameters = {
  query: {
    type: 'string',
    description: 'Optional words to match against group id, name or localized name.',
  },
  page: {
    type: 'integer',
    description: 'Page number, starting at 1. Defaults to 1.',
  },
  page_size: {
    type: 'integer',
    description: 'Number of groups per page, from 1 to 50. Defaults to 20.',
  },
} as const

export const rsyncParameters = {
  server: {
    type: 'string',
    required: true,
    description: 'Managed server id or exact server name.',
  },
  command: {
    type: 'string',
    required: true,
    description: 'A complete rsync command line beginning with rsync. Shell operators, globs and substitutions are rejected.',
  },
  timeout_ms: {
    type: 'integer',
    description: 'Maximum execution time in milliseconds. Defaults to 600000 and may not exceed 600000.',
  },
} as const

export const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}
