import {
  validateArgs,
  type ParameterSchemaSpec,
  type ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import { AdminError } from './model.ts'

const string = (description: string): ValueSchemaSpec => ({ type: 'string', description })
const required = (schema: ValueSchemaSpec) => ({ ...schema, required: true as const })
const closed = (properties: ParameterSchemaSpec): ValueSchemaSpec => ({
  type: 'object',
  properties,
  additionalProperties: false,
})
const id = string('UUID returned by the corresponding list/get tool; never invent an ID.')
const server = string(
  'Managed server UUID or exact name from platform_server_list; prefer its UUID.',
)
const configRevision = string(
  'Copy config_revision (a positive decimal string) from a fresh platform_server_get. On server_revision_conflict, get again and review changes before retrying.',
)
const instant = string(
  'ISO 8601 timestamp including Z or an explicit UTC offset, e.g. 2026-10-23T14:00:00+08:00.',
)
const group = {
  oneOf: [id, { type: 'null' }],
  description: 'Group UUID from platform_server_group_admin.list, or null for ungrouped.',
} satisfies ValueSchemaSpec
const rule = {
  oneOf: [
    closed({ kind: required({ type: 'string', enum: ['any'] }) }),
    closed({
      kind: required({ type: 'string', enum: ['exact'] }),
      version: required(string('Exact version.')),
    }),
    closed({
      kind: required({ type: 'string', enum: ['series'] }),
      prefix: required(string('Version series prefix, e.g. 28.')),
    }),
    closed({
      kind: required({ type: 'string', enum: ['minimum'] }),
      version: required(string('Minimum allowed version.')),
    }),
    closed({
      kind: required({ type: 'string', enum: ['range'] }),
      minimum: required(string('Inclusive lower version.')),
      maximum: required(string('Inclusive upper version.')),
    }),
  ],
} satisfies ValueSchemaSpec
const policies = {
  type: 'array',
  description:
    'Use [] to inherit the target type defaults. Custom policies may only narrow provider rules; at most 128 unique software_key entries. Keys and allowed versions come from group_admin.types → types[].software[].',
  items: closed({
    software_key: required(string('Copy software_key from the selected type software entry.')),
    restriction: required(rule),
    detect_updates: required({
      type: 'boolean',
      description: 'Whether to detect available updates for this software.',
    }),
  }),
  examples: [
    [],
    [
      {
        software_key: 'docker',
        restriction: { kind: 'series', prefix: '28' },
        detect_updates: true,
      },
    ],
  ],
} satisfies ValueSchemaSpec
const declaredOs = {
  oneOf: [
    closed({
      kind: required({ type: 'string', enum: ['custom'] }),
      text: required(string('User supplied OS description.')),
    }),
    closed({
      kind: required({ type: 'string', enum: ['catalog'] }),
      family: required(string('Catalog family.')),
      releaseKey: required(
        string(
          'Catalog release key; copy an existing operatingSystem.declared value from platform_server_get, never guess.',
        ),
      ),
      version: required(string('Catalog version.')),
      precision: required({ type: 'string', enum: ['release', 'series'] }),
      name: required(string('Catalog OS name.')),
    }),
  ],
} satisfies ValueSchemaSpec
const auditFilters = {
  from: instant,
  to: instant,
  server_id: id,
  kind: string('Audit kind filter.'),
  status: string('Audit status filter.'),
  session_id: string('Session ID filter.'),
  tool: string('Tool name filter.'),
  page: { type: 'integer', description: 'Page number, at least 1; default 1.' },
  page_size: { type: 'integer', description: 'Records per page, 1–100; default 20.' },
} satisfies ParameterSchemaSpec

interface ActionContract {
  description: string
  fields: ParameterSchemaSpec
}
interface ToolContract {
  description: string
  actions: Record<string, ActionContract>
}
const planId = { plan_id: required(id) }
const baseServer = { server: required(server), expected_config_revision: required(configRevision) }
const workflow =
  'Move/type/install workflow: platform_server_get → platform_server_group_admin.list/types → platform_server_admin.rebind → platform_server_upgrade_admin.show until awaiting_confirmation with every target preflight_state=ready → apply → show until terminal → platform_server_get to verify. Creating a plan does not execute it. Follow returned next_step; do not stop at plan creation when execution was requested. Calling apply executes directly under the host full-access permission preset; otherwise it opens the host user approval UI. The model cannot grant itself permissions.'

export const ADMIN_CONTRACTS = {
  platform_server_group_admin: {
    description:
      'Discover and manage server groups and available server types. System groups are read-only; user groups may be created/renamed/deleted under the host authorization policy. ' +
      workflow,
    actions: {
      list: {
        description:
          'Read groups including id, kind, available, default_type_key and types[].key/software. Select returned IDs/keys by name_i18n. No approval.',
        fields: {},
      },
      types: {
        description:
          'Read type/software options for a group or ungrouped servers, including default_type_key, supportedOs and software version rules. Use only available options compatible with the server OS. No approval.',
        fields: { group_id: required(group) },
      },
      create: {
        description: 'Create a user group; returns its id and type options.',
        fields: { name: required(string('Group name, 1–80 characters.')) },
      },
      rename: {
        description: 'Rename a user group.',
        fields: {
          group_id: required(id),
          name: required(string('New group name, 1–80 characters.')),
        },
      },
      delete: {
        description: 'Delete an empty user group. Move its servers first.',
        fields: { group_id: required(id) },
      },
    },
  },
  platform_server_key_admin: {
    description:
      'Manage platform SSH keys. Never accepts or returns private key material. Mutations execute directly under full access; otherwise they request host user approval. Read platform_server_get before rotation.',
    actions: {
      list: { description: 'Read key IDs, names and fingerprints.', fields: {} },
      create: {
        description: 'Generate and store an Ed25519 key; returns public metadata.',
        fields: { name: required(string('Key name, 1–80 characters.')) },
      },
      delete: {
        description: 'Delete an unused key; referenced keys cannot be deleted.',
        fields: { key_id: required(id) },
      },
      reveal: {
        description:
          'Return an authenticated human-only download URL (expires after 600 seconds). Present the link to the user; do not fetch it or read the private key.',
        fields: { key_id: required(id) },
      },
      rotate: {
        description:
          'Rotate one server from its current key to a newly generated key. Result includes operation_id/state. If requires_reconciliation=true, read platform_server_get.key_rotations and resume that same operation_id with a fresh config_revision; never blindly start another rotation.',
        fields: {
          server: required(id),
          key_id: required(
            string(
              'For a new rotation, current ssh_key_id from platform_server_get. For resume, keep the ORIGINAL old_key_id from key_rotations, even if the server already references the new key. Host generates the replacement.',
            ),
          ),
          expected_config_revision: required(configRevision),
          operation_id: string(
            'For resume only: unfinished operation_id from a prior rotate result, or id from platform_server_get.key_rotations.',
          ),
        },
      },
    },
  },
  platform_server_upgrade_admin: {
    description:
      'Manage single-server change plans for BOTH software upgrades AND group/type/install changes created by server_admin.rebind. Mutating actions execute directly under full access; otherwise they request host user approval. ' +
      workflow,
    actions: {
      check: {
        description:
          'Queue asynchronous software update detection. Returned items/checks may still be old. Poll suggestions (not check) and inspect checks.last_check_at/check_error before choosing versions.',
        fields: { server: required(server) },
      },
      suggestions: {
        description:
          'Read latest update suggestions without queuing another check. items contain software_key/product_version/validity; checks contain last_check_at/check_error/check_snapshot. Choose exact eligible versions, not latest or wildcard.',
        fields: { server: required(server), page: auditFilters.page },
      },
      plan: {
        description:
          'Create an upgrade draft and queue preflight; returns plan_id and next_step. Use rebind for type changes or installing missing type software.',
        fields: {
          ...baseServer,
          versions: required({
            type: 'object',
            additionalProperties: true,
            description:
              'Nonempty map of software_key to exact version STRING from suggestions.items (product_version); e.g. {"docker":"28.1.1"}. Each value must be a string; never use latest/wildcards.',
          }),
        },
      },
      show: {
        description:
          'Read plan id/kind/state/revision/review_digest and targets[].preflight_state/preflight_error/target_snapshot.changes/risks/result. draft means still checking; blocked means inspect errors. awaiting_confirmation + all ready permits apply. scheduled/running means execution pending, not completed. completed with all targets succeeded indicates plan success.',
        fields: planId,
      },
      apply: {
        description:
          'Schedule the exact reviewed move OR upgrade plan, requesting user approval only when the host has not granted full access. Copy revision/review_digest from the latest ready show; do not compute them. Read changes and risks, choose a maintenance window consistent with user intent. On plan_not_ready, show again and re-review. Result scheduled is not execution success; follow show.',
        fields: {
          ...planId,
          revision: required(
            string('Copy plan revision as a string from latest show, not server config_revision.'),
          ),
          review_digest: required(string('Copy review_digest from the same latest show response.')),
          start: required(instant),
          end: required({
            ...instant,
            description: 'ISO 8601 with timezone; later than start and now; window at most 7 days.',
          }),
          timezone: required(
            string('IANA time zone for the maintenance window, e.g. Asia/Shanghai or UTC.'),
          ),
        },
      },
      cancel: {
        description:
          'Cancel queued/pending plan work. Already running work may finish; cancellation does not roll back changes. Inspect returned targets/result.',
        fields: planId,
      },
    },
  },
  platform_audit_admin: {
    description:
      'Query, export and retain server audit records. No individual record editing/deletion. Export and retention writes execute directly under full access; otherwise they require host user approval.',
    actions: {
      query: {
        description: 'Read paginated audit records. Optional from/to must satisfy from < to.',
        fields: auditFilters,
      },
      export: {
        description:
          'Export filtered records, at most 10000, as a JSON download link valid for 600 seconds.',
        fields: auditFilters,
      },
      retention: {
        description:
          'mode=get reads policy; mode=run archives/verifies then deletes eligible records under current policy; mode=set requires days, archive_directory, next_run, enabled. Enabled policies run daily; at most 10000 records per batch.',
        fields: {
          mode: required({ type: 'string', enum: ['get', 'run', 'set'] }),
          days: { type: 'integer', description: 'Required for set: retention days, 1–36500.' },
          archive_directory: string(
            'Required for set: absolute host filesystem archive directory.',
          ),
          next_run: {
            ...instant,
            description: 'Required for set: future ISO 8601 time including timezone.',
          },
          enabled: {
            type: 'boolean',
            description: 'Required for set: enable daily automatic retention.',
          },
        },
      },
    },
  },
  platform_server_admin: {
    description:
      'Edit, move/retype or delete one managed server using a fresh config_revision and host authorization (full access or user approval). ' +
      workflow,
    actions: {
      update: {
        description:
          'Save configuration. patch must contain at least one field; omitted fields stay unchanged. SSH key switches auth to private_key; connection changes queue a connection test. Returns configuration_saved, server and connection_test; saving does not mean connection succeeded.',
        fields: {
          ...baseServer,
          patch: required(
            closed({
              name: string('Name, 1–80 characters.'),
              region: string('Region, 1–80 characters.'),
              declared_os: declaredOs,
              install_required_software: {
                type: 'boolean',
                description:
                  'Store installation preference; use rebind with install_missing=true to execute installation.',
              },
              host: string('SSH host, 1–255 characters.'),
              ssh_port: { type: 'integer', description: 'SSH port, 1–65535.' },
              ssh_user: string('SSH user, 1–80 characters.'),
              ssh_key_id: id,
            }),
          ),
        },
      },
      rebind: {
        description:
          'Create a move/type/install draft, NOT immediate execution. To install required software on the same type, use current group/type and install_missing=true. Returns plan_id; continue upgrade_admin.show/apply/show.',
        fields: {
          ...baseServer,
          target_group: required(group),
          target_type: string(
            'Copy types[].key from group_admin.types for the target group. Omission preserves current type (which must be valid in target group).',
          ),
          install_missing: required({
            type: 'boolean',
            description:
              'true installs missing required software during plan execution; false defers installation.',
          }),
          software_policies: required(policies),
        },
      },
      delete: {
        description:
          'Delete platform server record and queued work. Does not destroy the remote machine or uninstall its software.',
        fields: baseServer,
      },
    },
  },
} satisfies Record<string, ToolContract>

export type AdminTool = keyof typeof ADMIN_CONTRACTS
export const ADMIN_ACTIONS = {
  platform_server_group_admin: Object.keys(ADMIN_CONTRACTS.platform_server_group_admin.actions),
  platform_server_key_admin: Object.keys(ADMIN_CONTRACTS.platform_server_key_admin.actions),
  platform_server_upgrade_admin: Object.keys(ADMIN_CONTRACTS.platform_server_upgrade_admin.actions),
  platform_audit_admin: Object.keys(ADMIN_CONTRACTS.platform_audit_admin.actions),
  platform_server_admin: Object.keys(ADMIN_CONTRACTS.platform_server_admin.actions),
} satisfies Record<AdminTool, readonly string[]>

export function adminDescription(tool: AdminTool): string {
  const contract: ToolContract = ADMIN_CONTRACTS[tool]
  return (
    contract.description +
    '\nReturns JSON text (use JSON.parse in PTC). Explain results to the user in their language.\n' +
    Object.entries(contract.actions)
      .map(([action, spec]) => {
        const requiredFields = Object.entries(spec.fields)
          .filter(([, field]) => field.required)
          .map(([name]) => name)
        return `${action}: ${spec.description} Required input fields: ${requiredFields.join(', ') || 'none'}. Allowed fields: ${Object.keys(spec.fields).join(', ') || 'none (pass {})'}.`
      })
      .join('\n')
  )
}

export function adminParameters(tool: AdminTool): ParameterSchemaSpec {
  const contract: ToolContract = ADMIN_CONTRACTS[tool]
  const properties: ParameterSchemaSpec = {}
  // The host requires an object root and cannot express action-dependent requiredness.
  // Publish the merged fields, then validate the chosen action against the same contract.
  for (const spec of Object.values(contract.actions))
    for (const [name, { required: _, ...field }] of Object.entries(spec.fields)) {
      if (!properties[name] || !('oneOf' in properties[name])) properties[name] = field
    }
  return {
    action: required({
      type: 'string',
      enum: Object.keys(contract.actions),
      description:
        'Operation; see the action-specific required fields and result semantics in the tool description.',
    }),
    input: required({
      type: 'object',
      properties,
      additionalProperties: false,
      description:
        'Only fields allowed for the chosen action. Required fields differ by action; see tool description. Pass {} for list.',
    }),
  }
}

export function validateAdminInput(tool: AdminTool, action: string, input: unknown): void {
  const contract: ToolContract = ADMIN_CONTRACTS[tool]
  const spec = contract.actions[action]
  if (!spec) throw new AdminError('invalid_action')
  const violations = validateArgs({ input: required(closed(spec.fields)) }, { input })
  if (violations.length)
    throw new AdminError('invalid_request', { tool, action, violations, hint: spec.description })
  const values = input as Record<string, unknown>
  if (tool === 'platform_audit_admin' && action === 'retention') {
    const fields =
      values.mode === 'set'
        ? Object.fromEntries(
            Object.entries(spec.fields).map(([key, value]) => [key, required(value)]),
          )
        : { mode: spec.fields.mode! }
    const errors = validateArgs({ input: required(closed(fields)) }, { input })
    if (errors.length)
      throw new AdminError('invalid_request', {
        tool,
        action,
        violations: errors,
        hint: spec.description,
      })
  }
  if (tool === 'platform_server_upgrade_admin' && action === 'plan') {
    const versions = values.versions as Record<string, unknown>
    const invalid = Object.entries(versions)
      .filter(([, version]) => typeof version !== 'string' || !version.trim())
      .map(([key]) => `input.versions.${key}: expected a nonempty exact version string`)
    if (!Object.keys(versions).length)
      invalid.push('input.versions: must select at least one software version')
    if (invalid.length)
      throw new AdminError('invalid_request', { tool, action, violations: invalid })
  }
}
