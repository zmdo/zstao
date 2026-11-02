import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  confirmChangePlan,
  controlPlan,
  createChangePlan,
  listPlans,
  readChangePlan,
  retryChangePlan,
} from '../changes/service.ts'
import { type Deps } from '../dependencies.ts'
import { HttpError } from '../errors.ts'
import { object } from '../input.ts'
import {
  commonVersions,
  decideSuggestion,
  detectUpdates,
  executionRecords,
  inventory,
  listSuggestions,
} from '../upgrades/service.ts'
import { readJson, sendJson } from './reply.ts'
import { parseRecordFilter, parseSuggestionQuery, parseUpgradePage, parseUpgradePageSize } from './upgrade-query.ts'

const uuid = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i
export async function routeChanges(
  deps: Deps,
  req: IncomingMessage,
  res: ServerResponse,
  rest: string,
): Promise<void> {
  const db = deps.db,
    parts = rest.split('/').filter(Boolean),
    params = new URL(req.url ?? '/', 'http://localhost').searchParams
  if (parts[0] === 'inventory' && req.method === 'GET') return sendJson(res, 200, await inventory(deps))
  if (parts[0] === 'plans' && parts.length === 1) {
    if (req.method === 'GET') return sendJson(res, 200, await listPlans(db))
    if (req.method === 'POST')
      return sendJson(res, 202, { id: await createChangePlan(db, deps.definitions, await readJson(req)) })
  }
  if (parts[0] === 'plans' && uuid.test(parts[1] ?? '')) {
    const id = parts[1]!
    if (parts.length === 2 && req.method === 'GET') return sendJson(res, 200, await readChangePlan(db, id))
    if (parts.length === 3 && req.method === 'POST') {
      const action = parts[2]
      if (action === 'confirm') await confirmChangePlan(db, id, object(await readJson(req)))
      else if (action === 'pause' || action === 'cancel') await controlPlan(db, id, action)
      else if (action === 'retry')
        return sendJson(res, 202, { id: await retryChangePlan(db, deps.definitions, id) })
      else throw new HttpError(404, 'plan_not_ready')
      return sendJson(res, 200, await readChangePlan(db, id))
    }
  }
  if (parts[0] === 'detect' && req.method === 'POST')
    return sendJson(res, 202, await detectUpdates(deps, await readJson(req)))
  if (
    parts[0] === 'suggestions' &&
    parts.length === 3 &&
    uuid.test(parts[1] ?? '') &&
    req.method === 'POST'
  ) {
    await decideSuggestion(deps, parts[1]!, parts[2]!, await readJson(req))
    return sendJson(res, 200, { ok: true })
  }
  if (parts[0] === 'suggestions' && req.method === 'GET')
    return sendJson(res, 200, await listSuggestions(deps, parseSuggestionQuery(params)))
  if (parts[0] === 'versions' && req.method === 'POST')
    return sendJson(res, 200, await commonVersions(deps, await readJson(req)))
  if (parts[0] === 'records' && req.method === 'GET')
    return sendJson(res, 200, await executionRecords(deps, parseUpgradePage(params), parseUpgradePageSize(params), parseRecordFilter(params)))
  throw new HttpError(404, 'plan_not_ready')
}
