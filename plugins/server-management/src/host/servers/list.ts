import { type LocalizedText } from '../../shared/contracts/common.ts'
import { typeSupportsOs } from '../../shared/definitions.ts'
import { ServerError } from '../../shared/errors.ts'
import { osLabel, osVerification, parseDeclaredOs } from '../../shared/operating-systems.ts'
import { type SoftwarePolicy } from '../../shared/policies.ts'
import {
  type DisplayStatus,
  type ServerDisplayStatus,
  type StatusReason,
} from '../../shared/server-status.ts'
import { type ServerListItem, type ServerListPage } from '../../shared/dto/servers.ts'
import type { ServerTypeView } from '../../shared/definitions.ts'
import type { DeclaredOs } from '../../shared/operating-system-types.ts'
import { type Db } from '../database/connection.ts'
import { readTransaction } from '../database/transaction.ts'
import { policySignature } from '../definitions/policies.ts'
import { DefinitionRegistry } from '../definitions/registry.ts'
import * as groupRepository from '../groups/persistence/repository.ts'
import { type GroupRow } from '../groups/persistence/rows.ts'
import * as list from './persistence/list-repository.ts'
import { type ActiveOperation, type ServerFact, type SoftwareFact } from './persistence/rows.ts'
import { type ServerListQuery } from './query.ts'

function recent(date: Date | null, now: number, maxAge: number): boolean {
  return date !== null && date.getTime() <= now && now - date.getTime() <= maxAge
}
function reason(code: StatusReason['code'], parameters: Record<string, string> = {}): StatusReason {
  return { code, parameters }
}


function safeTypeSnapshot(key: string, value: unknown): ServerTypeView {
  const raw = value !== null && typeof value === 'object' ? value as Partial<ServerTypeView> : {}
  const names = raw.name_i18n !== null && typeof raw.name_i18n === 'object' ? raw.name_i18n : undefined
  const zh = typeof names?.zh === 'string' && names.zh !== '' ? names.zh : key
  const en = typeof names?.en === 'string' && names.en !== '' ? names.en : zh
  return {
    key: typeof raw.key === 'string' && raw.key !== '' ? raw.key : key,
    name_i18n: { zh, en },
    software: Array.isArray(raw.software) ? raw.software : [],
    supportedOs: raw.supportedOs !== null && typeof raw.supportedOs === 'object' ? raw.supportedOs : { kind: 'all' },
  }
}

function safeDeclaredOs(value: unknown): DeclaredOs {
  try {
    return parseDeclaredOs(value)
  } catch {
    return { kind: 'custom', text: 'Unknown OS' }
  }
}

export function displayStatus(input: {
  row: Pick<ServerFact, 'reachability' | 'connection_error' | 'last_checked_at' | 'os_checked_at'>
  verification: string
  available: boolean
  compatible: boolean
  software: readonly {
    key: string
    name?: LocalizedText
    state: string
    healthy: boolean | null
    compliant: boolean
    detail?: string
  }[]
  operation?: ActiveOperation
  now: number
  maxAge: number
}): DisplayStatus {
  const { row, operation, now, maxAge } = input
  const attention: StatusReason[] = [],
    unverified: StatusReason[] = []
  if (!input.available) attention.push(reason('type_unavailable'))
  else if (!input.compatible) attention.push(reason('os_unsupported'))
  if (input.verification === 'mismatch') attention.push(reason('os_mismatch'))
  else if (input.verification !== 'custom' && (input.verification !== 'matched' || !recent(row.os_checked_at, now, maxAge)))
    unverified.push(reason('os_unverified'))
  for (const software of input.software) {
    const parameters = {
      software: software.key,
      softwareZh: software.name?.zh ?? software.key,
      softwareEn: software.name?.en ?? software.key,
    }
    if (software.state === 'missing') attention.push(reason('software_missing', parameters))
    else if (software.state !== 'installed')
      (software.detail?.includes('permission denied') ? attention : unverified).push(
        reason('software_unknown', parameters),
      )
    else if (software.healthy === false) attention.push(reason('software_unhealthy', parameters))
    else if (!software.compliant) attention.push(reason('software_version', parameters))
    else if (software.healthy !== true) unverified.push(reason('software_unknown', parameters))
  }
  if (row.reachability === 'offline')
    attention.unshift(reason('connection_failed', { detail: row.connection_error?.message ?? '' }))
  else if (row.reachability !== 'online') unverified.unshift(reason('connection_unknown'))
  else if (!recent(row.last_checked_at, now, maxAge)) unverified.unshift(reason('connection_stale'))
  const reasons = [...attention, ...unverified]
  const result = (
    code: ServerDisplayStatus,
    extra: StatusReason[] = [],
    jobId: string | null = null,
  ): DisplayStatus => ({ code, reasons: [...extra, ...reasons], jobId })
  if (operation?.mutation_phase) {
    const owned = operation.lease_expires_at !== null && operation.lease_expires_at.getTime() > now
    const remoteKnown =
      operation.result?.remote_state === 'running' &&
      recent(
        operation.result.remote_checked_at ? new Date(operation.result.remote_checked_at) : null,
        now,
        maxAge,
      )
    if (!owned) return result('attention', [reason('operation_expired')], operation.id)
    if (operation.state === 'recovering' && !remoteKnown)
      return result('attention', [reason('operation_recovering')], operation.id)
    if (operation.state === 'running' || (operation.state === 'recovering' && remoteKnown))
      return result(
        operation.mutation_phase === 'upgrading' ? 'upgrading' : 'installing',
        [reason('operation_running')],
        operation.id,
      )
  }
  if (row.reachability === 'offline') return result('disconnected')
  if (attention.length) return result('attention')
  if (unverified.length) return result('unverified')
  return result('normal')
}

interface ReadDeps {
  db: Db
  definitions: DefinitionRegistry
  freshnessMs?: number
}

async function readSnapshot<T>(
  deps: ReadDeps,
  query: ServerListQuery | { id: string },
  project: (data: {
    rows: ReturnType<typeof enrich>[]
    groups: import('../../shared/dto/groups.ts').GroupView[]
    counts: { all: number; ungrouped: number }
    groupId: string | null
    now: number
  }) => T,
): Promise<T> {
  return readTransaction(deps.db, async (client) => {
    const now = (await list.snapshotTime(client)).rows[0]!.now.getTime()
    const groups = (await groupRepository.listGroups(client)).rows
    const counts = (await list.counts(client)).rows[0]!
    const groupId =
      'groupId' in query && query.groupId && !groups.some((group) => group.id === query.groupId)
        ? null
        : 'groupId' in query
          ? query.groupId
          : null
    const records = (
      await list.servers(client, {
        id: 'id' in query ? query.id : null,
        allGroups: groupId === null,
        groupId: groupId || null,
      })
    ).rows
    const ids = records.map((row) => row.id)
    const observations = (await list.observations(client, ids)).rows
    const operations = (await list.operations(client, ids)).rows
    const policies = (await list.policies(client, ids)).rows
    const upgrades = (await list.upgradeCounts(client, ids)).rows
    const byServer = new Map<string, Map<string, SoftwareFact>>()
    for (const observation of observations) {
      if (!byServer.has(observation.server_id)) byServer.set(observation.server_id, new Map())
      byServer.get(observation.server_id)!.set(observation.software_key, observation)
    }
    const byOperation = new Map(operations.map((operation) => [operation.server_id, operation]))
    const byGroup = new Map(groups.map((group) => [group.id, group]))
    // No await while resolving definitions, deriving status and filtering the entire candidate set.
    const rows = records.map((row) =>
      enrich(
        row,
        row.group_id ? byGroup.get(row.group_id)! : null,
        byServer.get(row.id),
        byOperation.get(row.id),
        deps.definitions,
        now,
        deps.freshnessMs ?? 90_000,
        policies.filter((p) => p.server_id === row.id),
        upgrades.filter((u) => u.server_id === row.id),
      ),
    )
    const result = project({
      rows,
      groups: groups.map((group) => deps.definitions.view(group)),
      counts,
      groupId,
      now,
    })
    return result
  })
}

function enrich(
  row: ServerFact,
  group: GroupRow | null,
  observations: Map<string, SoftwareFact> | undefined,
  operation: ActiveOperation | undefined,
  definitions: DefinitionRegistry,
  now: number,
  maxAge: number,
  policies: SoftwarePolicy[],
  upgradeCounts: { count: number; definition: string }[],
) {
  const declaredOs = safeDeclaredOs(row.declared_os)
  const osState =
    String(row.observed_config_revision) === String(row.config_revision) ? row.os_probe_state : 'unknown'
  const verification = osVerification(declaredOs, row.detected_os, osState)
  let resolved: ReturnType<DefinitionRegistry['describeType']>
  try {
    resolved = definitions.describeType(
      group,
      row.type_key,
      verification === 'matched' && row.detected_os ? row.detected_os : declaredOs,
    )
  } catch (cause) {
    if (!(cause instanceof ServerError)) throw cause
  }
  const type = resolved?.type ?? safeTypeSnapshot(row.type_key, row.type_snapshot)
  const available = resolved !== undefined
  const upgradeCount = resolved
    ? upgradeCounts
        .filter((u) => u.definition === policySignature(resolved.signature, policies))
        .reduce((n, u) => n + u.count, 0)
    : 0
  const required = type.software.map((item) => {
    const component = resolved?.components.find((c) => c.software_key === item.software_key),
      policy = policies.find((p) => p.software_key === item.software_key)
    return {
      ...item,
      versions:
        component && policy
          ? (component.adapter.intersect([component.versions, policy.restriction]) ?? component.versions)
          : item.versions,
    }
  })
  const components = new Map(
    (resolved?.components ?? []).map((component) => [component.software_key, component]),
  )
  const software_status: Record<
    string,
    {
      state: string
      installed: boolean
      version?: string
      last_known_version?: string | null
      detail?: string
      revision?: string
    }
  > = {}
  const software = required.map((item) => {
    const fact = observations?.get(item.software_key)
    const fresh =
      fact &&
      fact.recipe_revision === item.revision &&
      fact.recipe_key === item.recipe &&
      String(fact.observed_config_revision) === String(row.config_revision) &&
      String(fact.observed_environment_revision) === String(row.environment_revision) &&
      recent(fact.checked_at, now, maxAge)
    const state = fresh ? fact.probe_state : 'unknown'
    const component = components.get(item.software_key)
    let compliant = false
    if (state === 'installed' && fact?.product_version && component) {
      try {
        compliant = component.adapter.contains(
          required.find((s) => s.software_key === item.software_key)?.versions ?? component.versions,
          fact.product_version,
        )
      } catch (cause) {
        if (!(cause instanceof ServerError)) throw cause
      }
    }
    software_status[item.id] = {
      state,
      installed: state === 'installed',
      version: state === 'installed' ? (fact?.product_version ?? undefined) : undefined,
      last_known_version: fact?.product_version,
      detail: fact?.error?.detail,
      revision: fact?.recipe_revision,
    }
    return {
      key: item.software_key,
      name: item.name_i18n,
      state,
      healthy: fresh ? fact.healthy : null,
      compliant,
      detail: fact?.error?.detail,
    }
  })
  const compatible = typeSupportsOs(
    type,
    verification === 'matched' && row.detected_os ? row.detected_os : declaredOs,
  )
  const status = displayStatus({ row, verification, available, compatible, software, operation, now, maxAge })
  const installation = {
    enabled: row.install_required_software,
    applicability: !available
      ? ('unavailable' as const)
      : required.length
        ? ('applicable' as const)
        : ('not-applicable' as const),
  }
  const softwareState = !available
    ? 'unavailable'
    : software.some((item) => item.state === 'missing')
      ? 'pending'
      : software.every((item) => item.state === 'installed' && item.healthy === true && item.compliant)
        ? 'ready'
        : 'unknown'
  return {
    ...row,
    upgrade_count: upgradeCount,
    software_policies: policies,
    group_name: group?.name ?? null,
    group_name_i18n: group?.name_i18n ?? null,
    software_status,
    os_verification: verification,
    type_supported_os: type.supportedOs,
    type_os_compatible: compatible,
    declared_os: declaredOs,
    type_name_i18n: type.name_i18n,
    type_available: available,
    required_software: required,
    software_state: softwareState,
    status,
    installation,
    resources_fresh: recent(row.metrics_at, now, maxAge),
  }
}

function listItem(row: ReturnType<typeof enrich>): ServerListItem {
  return {
    id: row.id,
    name: row.name,
    upgradeCount: row.upgrade_count,
    address: { host: row.host, port: row.ssh_port },
    region: row.region,
    group: row.group_id === null ? null : {
      id: row.group_id,
      name: row.group_name ?? '',
      name_i18n: row.group_name_i18n ?? null,
    },
    internal_host: row.internal_host,
    operatingSystem: {
      declared: row.declared_os,
      label: osLabel(row.declared_os),
      verification: row.os_verification,
    },
    type: { key: row.type_key, name: row.type_name_i18n, available: row.type_available },
    status: row.status,
    installRequiredSoftware: row.installation,
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
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
  }
}

export async function serverList(deps: ReadDeps, query: ServerListQuery): Promise<ServerListPage> {
  return readSnapshot(deps, query, ({ rows, groups, counts, groupId }) => {
    const needle = query.query.toLocaleLowerCase()
    const selected = rows.filter(
      (row) =>
        (!query.needsUpgrade || row.upgrade_count > 0) &&
        (!query.status || row.status.code === query.status) &&
        (!needle ||
          [
            row.name,
            row.host,
            `${row.host}:${row.ssh_port}`,
            row.ssh_user,
            row.region,
            row.group_name ?? '',
            row.group_name_i18n?.zh ?? '',
            row.group_name_i18n?.en ?? '',
            row.type_key,
            row.type_name_i18n.zh,
            row.type_name_i18n.en,
            osLabel(row.declared_os),
            row.declared_os.kind === 'catalog' ? row.declared_os.family : '',
          ].some((value) => value.toLocaleLowerCase().includes(needle))),
    )
    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    selected.sort(
      (a, b) =>
        (query.order === 'last_checked'
          ? (b.last_checked_at?.getTime() ?? -Infinity) - (a.last_checked_at?.getTime() ?? -Infinity)
          : 0) ||
        compare(a.name, b.name) ||
        compare(a.id, b.id),
    )
    const page = Math.max(1, Math.min(query.page, Math.ceil(selected.length / query.pageSize)))
    return {
      items: selected.slice((page - 1) * query.pageSize, page * query.pageSize).map(listItem),
      total: selected.length,
      page,
      page_size: query.pageSize,
      group_id: groupId,
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        name_i18n: group.name_i18n,
        kind: group.kind,
        plugin_id: group.plugin_id,
        available: group.available,
        server_count: group.server_count ?? 0,
      })),
      counts,
    }
  })
}

export async function serverRead(deps: ReadDeps, id: string) {
  return readSnapshot(deps, { id }, ({ rows }) => rows[0])
}

export type { ActiveOperation } from './persistence/rows.ts'
