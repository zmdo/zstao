import type { RecordPage, Suggestions } from '../../shared/dto/upgrades.ts'
import { ServerError } from '../../shared/errors.ts'
import { transaction } from '../database/transaction.ts'
import { restrictLease } from '../definitions/policies.ts'
import { type Deps } from '../dependencies.ts'
import { HttpError } from '../errors.ts'
import { object } from '../input.ts'
import { readPolicies } from '../servers/persistence/policy-repository.ts'
import { queueDetection } from './detection.ts'
import * as upgrades from './persistence/repository.ts'
import { type SuggestionQuery } from './query.ts'

type UpgradeDeps = Pick<Deps, 'db' | 'definitions' | 'updateCheckIntervalSeconds'>

const uuid = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i
export async function inventory(deps: UpgradeDeps) {
  return (await upgrades.inventory(deps.db)).rows
}
export async function listSuggestions(deps: UpgradeDeps, filter: SuggestionQuery): Promise<Suggestions> {
  const db = deps.db
  const { page, query, decision: state, group, type, software, connection, current, target, server } = filter,
    pageSize = 20
  const rows = (await upgrades.suggestions(db)).rows
  const signatures = await currentSignatures(deps, [...new Set(rows.map((r) => String(r.server_id)))])
  for (const row of rows)
    if (signatures.get(String(row.server_id)) !== row.basis_snapshot.definitionRevision) {
      row.validity = 'blocked'
      row.reason = { ...row.reason, code: 'job_definition_changed' }
    }
  const filtered = rows.filter((r) => {
    const deferred = r.reminder_after && new Date(String(r.reminder_after)).getTime() > Date.now()
    return (
      (!server || r.server_id === server) &&
      (!query ||
        [r.server_name, r.host, r.software_key].some((v) => String(v).toLowerCase().includes(query))) &&
      (!group || r.group_id === group) &&
      (!type || r.type_key === type) &&
      (!software || r.software_key === software) &&
      (!connection || r.connection_state === connection) &&
      (!current || r.basis_snapshot.before.version.includes(current)) &&
      (!target || String(r.product_version).includes(target)) &&
      (!state ||
        state === 'all' ||
        (state === 'pending' && r.decision === 'none' && !deferred && !r.scheduled) ||
        (state === 'deferred' && deferred) ||
        (state === 'rejected' && r.decision === 'rejected') ||
        (state === 'scheduled' && r.scheduled))
    )
  })
  const checks = (await upgrades.checks(db)).rows
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize).map((row) => ({
      ...row,
      reminder_after: row.reminder_after?.toISOString() ?? null,
    })),
    total: filtered.length,
    page,
    page_size: pageSize,
    filtered_server_ids: [...new Set(filtered.map((r) => r.server_id))],
    checks: checks
      .filter(
        (r) =>
          (!server || r.server_id === server) &&
          (!group || r.group_id === group) &&
          (!type || r.type_key === type) &&
          (!software || r.software_key === software) &&
          (!connection || r.connection_state === connection) &&
          (!query ||
            [r.server_name, r.host, r.software_key].some((v) => String(v).toLowerCase().includes(query))),
      )
      .map((row) => ({ ...row, last_check_at: row.last_check_at?.toISOString() ?? null })),
  }
}
export async function commonVersions(deps: UpgradeDeps, body: unknown) {
  const db = deps.db
  const input = object(body),
    ids = input.server_ids,
    software = input.software
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
    typeof software !== 'string'
  )
    throw new HttpError(422, 'upgrade_invalid')
  const rows = (await upgrades.versionChecks(db, ids, software)).rows
  const signatures = await currentSignatures(deps, ids)
  const blockers = ids.filter(
    (id) =>
      !rows.some(
        (r) =>
          r.server_id === id &&
          r.check_snapshot &&
          r.check_snapshot.basis.configRevision === String(r.config_revision) &&
          r.check_snapshot.basis.environmentRevision === String(r.environment_revision) &&
          r.check_snapshot.basis.definitionRevision === signatures.get(r.server_id),
      ),
  )
  const versions = blockers.length
    ? []
    : [...new Set(rows[0]!.check_snapshot!.eligible.map((c) => c.version))].filter((v) =>
        rows.every((r) => r.check_snapshot!.eligible.some((c) => c.version === v)),
      )
  return { versions, blockers }
}
export async function executionRecords(
  deps: UpgradeDeps,
  page: number,
  pageSize = 20,
  filter: upgrades.RecordFilter = { query: '', state: '', since: null },
): Promise<RecordPage> {
  const db = deps.db
  const rows = (await upgrades.records(db, (page - 1) * pageSize, pageSize, filter)).rows
  const total = (await upgrades.recordCount(db, filter)).rows[0]!.count
  return {
    items: rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
      finished_at: row.finished_at?.toISOString() ?? null,
    })),
    total: Number(total),
    page,
    page_size: pageSize,
  }
}
export async function decideSuggestion(deps: UpgradeDeps, id: string, action: string, body: unknown) {
  const db = deps.db,
    input = object(body)
  await transaction(db, async (c) => {
    const suggestion = (await upgrades.lockSuggestion(c, id)).rows[0]
    if (!suggestion) throw new HttpError(404, 'upgrade_invalid')
    if (action === 'reject' || action === 'restore')
      await upgrades.setDecision(c, id, action === 'reject' ? 'rejected' : 'none')
    else if (action === 'defer') {
      const until = input.until === null ? null : new Date(String(input.until))
      if (until && (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()))
        throw new HttpError(422, 'upgrade_invalid')
      await upgrades.setReminder(c, {
        serverId: suggestion.server_id,
        softwareKey: suggestion.software_key,
        until,
      })
    } else throw new HttpError(422, 'upgrade_invalid')
  })
}
export async function detectUpdates(deps: UpgradeDeps, body: unknown) {
  const input = object(body)
  if (
    !Array.isArray(input.server_ids) ||
    !input.server_ids.length ||
    input.server_ids.length > 500 ||
    input.server_ids.some((id) => typeof id !== 'string' || !uuid.test(id))
  )
    throw new HttpError(422, 'upgrade_invalid')
  await queueDetection(deps.db, input.server_ids, false, deps.updateCheckIntervalSeconds)
  return { queued: input.server_ids.length }
}
async function currentSignatures(deps: UpgradeDeps, ids: string[]): Promise<Map<string, string>> {
  const servers = (await upgrades.signatureServers(deps.db, ids)).rows
  const signatures = new Map<string, string>()
  for (const server of servers) {
    const lease = await deps.definitions.lease(
      server.group_id,
      server.type_key,
      server.detected_os ?? server.declared_os,
    )
    if (!lease) continue
    try {
      signatures.set(server.id, restrictLease(lease, await readPolicies(deps.db, server.id)).signature)
    } catch (cause) {
      if (!(cause instanceof ServerError)) throw cause
    } finally {
      lease.release()
    }
  }
  return signatures
}
