import { activeRotations } from '../servers/persistence/repository.ts'
import type { DefinitionRegistry } from '../definitions/registry.ts'
import type { Db } from '../database/connection.ts'
import type { SshSession } from '../remote/ssh.ts'
import type { ExecLimits } from './exec.ts'
import { type ServerListQuery } from '../servers/query.ts'
import { serverList, serverRead } from '../servers/list.ts'
import type { ServerDisplayStatus } from '../../shared/server-status.ts'

export interface HarnessDeps {
  db: Db
  definitions: DefinitionRegistry
  freshnessMs?: number
  secrets?: { decrypt(ciphertext: string): string }
  execLimits?: ExecLimits
  connect?: (input: {
    host: string
    port: number
    username: string
    authMethod: string
    secret: string
    expectedFingerprint: string | null
    readyTimeoutMs?: number
  }) => Promise<SshSession>
}

export interface ListInput {
  query?: string
  status?: ServerDisplayStatus
  group?: string
  page?: number
  page_size?: number
}

interface ResolvedServer {
  id: string
  name: string
  host: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeListQuery(input: ListInput, groupId: string | null): ServerListQuery {
  return {
    groupId,
    query: input.query?.trim() ?? '',
    status: input.status ?? '',
    order: 'name',
    page: Math.max(1, input.page ?? 1),
    pageSize: Math.max(1, Math.min(50, input.page_size ?? 20)),
  }
}

export async function listHarnessServers(deps: HarnessDeps, input: ListInput) {
  const groupId = await resolveGroup(deps, input.group)
  const page = await serverList(deps, safeListQuery(input, groupId))
  return {
    total: page.total,
    page: page.page,
    page_size: page.page_size,
    pages: Math.max(1, Math.ceil(page.total / page.page_size)),
    items: page.items.map((item) => ({
      id: item.id,
      name: item.name,
      host: item.address.host,
      port: item.address.port,
      region: item.region,
      group: item.group,
      type: item.type.name,
      status: item.status,
      operatingSystem: item.operatingSystem,
      resources: item.resources,
      lastCheckedAt: item.lastCheckedAt,
    })),
  }
}

async function resolveGroup(deps: HarnessDeps, group: string | undefined): Promise<string | null> {
  const value = group?.trim()
  if (value === undefined || value === '') return null
  const page = await serverList(deps, { groupId: null, query: '', status: '', order: 'name', page: 1, pageSize: 1 })
  const match = page.groups.find((item) =>
    item.id === value || item.name === value || item.name_i18n?.zh === value || item.name_i18n?.en === value,
  )
  if (match === undefined) throw new Error(JSON.stringify({ code: 'group_not_found', message: `Group is not managed by this platform: ${value}` }))
  return match.id
}

export async function listHarnessGroups(deps: HarnessDeps, input: { query?: string; page?: number; page_size?: number } = {}) {
  const page = await serverList(deps, { groupId: null, query: '', status: '', order: 'name', page: 1, pageSize: 1 })
  const needle = input.query?.trim().toLocaleLowerCase() ?? ''
  const filtered = page.groups.filter((group) =>
    needle === '' ||
    [group.id, group.name, group.name_i18n?.zh ?? '', group.name_i18n?.en ?? '']
      .some((value) => value.toLocaleLowerCase().includes(needle)),
  )
  const pageSize = Math.max(1, Math.min(50, input.page_size ?? 20))
  const current = Math.min(Math.max(1, input.page ?? 1), Math.max(1, Math.ceil(filtered.length / pageSize)))
  return {
    total: filtered.length,
    page: current,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    ungrouped: page.counts.ungrouped,
    items: filtered.slice((current - 1) * pageSize, current * pageSize).map((group) => ({
      id: group.id,
      name: group.name,
      name_i18n: group.name_i18n,
      kind: group.kind,
      server_count: group.server_count,
    })),
  }
}

export async function getHarnessServer(deps: HarnessDeps, server: string) {
  const target = await resolveServer(deps, server)
  const row = await serverRead(deps, target.id)
  if (row === undefined) throw new Error(serverNotFound(server))
  return { ...detail(row), key_rotations: (await activeRotations(deps.db, row.id)).rows }
}

async function resolveServer(deps: HarnessDeps, input: string): Promise<ResolvedServer> {
  const value = input.trim()
  if (value === '') throw new Error(serverNotFound(input))
  if (UUID.test(value)) {
    const row = await serverRead(deps, value)
    if (row !== undefined) return { id: row.id, name: row.name, host: row.host }
  }
  const page = await serverList(deps, {
    groupId: null,
    query: value,
    status: '',
    order: 'name',
    page: 1,
    pageSize: 100,
  })
  const matches = page.items.filter((item) => item.name === value)
  if (matches.length === 0) throw new Error(serverNotFound(value))
  if (matches.length > 1)
    throw new Error(
      JSON.stringify({
        code: 'server_ambiguous',
        message: 'Server name matches more than one managed server.',
        candidates: matches.map((item) => ({
          id: item.id,
          name: item.name,
          host: item.address.host,
        })),
      }),
    )
  const match = matches[0]!
  return { id: match.id, name: match.name, host: match.address.host }
}

function serverNotFound(value: string): string {
  return JSON.stringify({
    code: 'server_not_managed',
    message: `Server is not managed by this platform: ${value}`,
  })
}

function detail(row: NonNullable<Awaited<ReturnType<typeof serverRead>>>) {
  return {
    id: row.id,
    config_revision: String(row.config_revision),
    group_id: row.group_id,
    type_key: row.type_key,
    ssh_user: row.ssh_user,
    auth_method: row.auth_method,
    ssh_key_id: row.ssh_key_id,
    host_fingerprint: row.host_fingerprint,
    name: row.name,
    host: row.host,
    port: row.ssh_port,
    region: row.region,
    group: row.group_name_i18n ?? row.group_name,
    type: row.type_name_i18n,
    status: row.status,
    operatingSystem: {
      declared: row.declared_os,
      detected: row.detected_os,
      verification: row.os_verification,
      compatible: row.type_os_compatible,
    },
    connection: {
      state: row.reachability,
      error: row.connection_error,
      lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    },
    resources: {
      cpuModel: row.cpu_model,
      cpuCores: row.cpu_cores,
      cpuPercent: row.cpu_percent === null ? null : Number(row.cpu_percent),
      memoryUsed: row.mem_used_bytes,
      memoryTotal: row.mem_total_bytes,
      diskUsed: row.disk_used_bytes,
      diskTotal: row.disk_total_bytes,
      sampledAt: row.metrics_at?.toISOString() ?? null,
      fresh: row.resources_fresh,
    },
    software: row.required_software.map((item) => {
      const status = row.software_status[item.id]
      return {
        key: item.software_key,
        name: item.name_i18n,
        state: status?.state ?? 'unknown',
        version: status?.version ?? null,
        lastKnownVersion: status?.last_known_version ?? null,
        detail: status?.detail,
      }
    }),
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
  }
}
