import type { Json } from '../../shared/contracts/common.ts'
import type { ServerDto } from '../../shared/dto/servers.ts'
import type { DeclaredOs } from '../../shared/operating-system-types.ts'
import type { DbClient } from '../database/connection.ts'

export interface ExtensionInspectionServer {
  id: string
  host: string
  ssh_port: number
  ssh_user: string
  type_key: string
  declared_os: DeclaredOs
  config_revision: string | number
}

/** Host-only callbacks. They never cross the client contract boundary. */
export interface ServerExtensionRuntime {
  queries?: Record<string, (server: ServerDto, search: URLSearchParams) => Promise<Json>>
  settings?: Record<string, { defaults: Json; validate(value: unknown): Json }>
  inspections?: Record<string, {
    enabled?(value: Json | undefined): boolean
    validate(raw: string): Json
    commit?(db: DbClient, server: ExtensionInspectionServer, result: Json): Promise<void>
  }>
}

/** Trusted host plugins register callbacks; this interface is not sent to the browser. */
export interface ServerManagementHostContract {
  registerDefinitions(input: import('../../shared/contracts/definitions.ts').DefinitionBundle): import('../../shared/contracts/definitions.ts').Registration
  registerServerExtensions(input: import('../../shared/contracts/extensions.ts').ServerExtensionBundle, runtime?: ServerExtensionRuntime): import('../../shared/contracts/definitions.ts').Registration
}
