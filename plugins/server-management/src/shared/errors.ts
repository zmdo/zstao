export const ERROR_CODES = [
  'request_failed',
  'unauthorized',
  'invalid_request',
  'server_not_found',
  'group_not_found',
  'group_not_empty',
  'key_not_found',
  'job_not_found',
  'method_not_allowed',
  'job_not_saved',
  'name_required',
  'host_required',
  'user_required',
  'auth_required',
  'key_required',
  'password_required',
  'server_exists',
  'private_key_required',
  'connection_failed',
  'group_name_required',
  'group_name_reserved',
  'group_exists',
  'key_invalid',
  'key_exists',
  'key_in_use',
  'components_required',
  'port_invalid',
  'region_invalid',
  'component_unknown',
  'component_dependency',
  'key_encrypted',
  'auth_unsupported',
  'fingerprint_missing',
  'fingerprint_mismatch',
  'ssh_auth_failed',
  'ssh_timeout',
  'ssh_connect_timeout',
  'ssh_handshake_timeout',
  'ssh_auth_timeout',
  'ssh_closed',
  'ssh_refused',
  'ssh_failed',
  'command_timeout',
  'command_failed',
  'upload_failed',
  'shell_failed',
  'terminal_failed',
  'component_directory',
  'component_id',
  'docker_version_failed',
  'compose_version_failed',
  'containers_failed',
  'component_install_failed',
  'component_cycle',
  'definitions_unavailable',
  'group_registration_exists',
  'component_registration_conflict',
  'component_script_path',
  'type_definition_conflict',
  'group_registration_failed',
  'group_definition_invalid',
  'definition_unsupported',
  'software_detection_unknown',
  'software_dependency_unready',
  'software_install_unverified',
  'job_configuration_changed',
  'job_definition_changed',
  'secret_unavailable',
  'type_unavailable',
  'type_not_found',
  'required_software_readonly',
  'type_change_requires_preflight',
  'server_busy',
  'no_required_software',
  'group_source_readonly',
  'system_group_protected',
  'os_required',
  'os_invalid',
  'os_definition_invalid',
  'os_type_unsupported',
  'os_mismatch',
  'os_unverified',
  'os_probe_failed',
  'version_invalid',
  'recipe_protocol',
  'recipe_unavailable',
  'plan_conflict',
  'job_lease_lost',
  'job_recovering',
  'definition_owner',
  'definition_reference',
  'extension_definition_invalid',
  'extension_definition_conflict',
  'extension_registration_exists',
  'extension_not_found',
  'extension_unavailable',
  'extension_query_unavailable',
  'extension_settings_unavailable',
  'extension_settings_invalid',
  'extension_settings_conflict',
  'extension_settings_requires_plan',
  'extension_plan_not_found',
  'extension_plan_not_pending',
  'extension_plan_expired',
  'extension_plan_invalid',
  'extension_inspection_failed',
  'extension_inspection_unavailable',
  'extension_inspection_setting_changed',
  'connection_test_required',
  'task_query_invalid',
  'job_not_cancellable',
  'inspection_software_failed',
  'server_query_invalid',
  'policy_invalid',
  'policy_widens_type',
  'upgrade_invalid',
  'plan_not_ready',
  'plan_ack_required',
  'upgrade_no_common_version',
  'schedule_time_invalid',
  'binding_commit_failed',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
export type MessageParams = Readonly<Record<string, string | number>>

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODES.some((code) => code === value)
}

/** Domain errors carry codes and parameters; presentation belongs to the caller. */
export class ServerError extends Error {
  readonly code: ErrorCode
  readonly params: MessageParams
  constructor(code: ErrorCode, params: MessageParams = {}, options?: ErrorOptions) {
    super(code, options)
    this.name = 'ServerError'
    this.code = code
    this.params = params
  }
}

/** Validate structured errors at HTTP and persisted-result boundaries. */
export function parseError(payload: unknown): ServerError {
  if (typeof payload !== 'object' || payload === null) return new ServerError('request_failed')
  const { code, params, detail } = payload as { code?: unknown; params?: unknown; detail?: unknown }
  if (isErrorCode(code)) {
    const values: Record<string, string | number> = {}
    if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' || typeof value === 'number') values[key] = value
      }
    }
    return new ServerError(code, values)
  }
  return new ServerError('request_failed', typeof detail === 'string' ? { detail } : {})
}
