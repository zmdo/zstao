import { randomUUID } from 'node:crypto'
import type { Candidate } from '../../shared/contracts/recipes.ts'
import { ServerError } from '../../shared/errors.ts'
import type { Db } from '../database/connection.ts'
import { transaction } from '../database/transaction.ts'
import { type TypeLease } from '../definitions/model.ts'
import { owned } from '../execution/ownership.ts'
import { type JobRecord } from '../execution/persistence/rows.ts'
import { saveComponentStatus } from '../servers/persistence/observation-repository.ts'
import { type ServerSecret } from '../servers/persistence/rows.ts'
import type { UpdateCheck } from './model.ts'
import * as repository from './persistence/background-repository.ts'

export async function saveUpdateChecks(
  db: Db,
  job: JobRecord,
  server: ServerSecret,
  lease: TypeLease,
  checks: UpdateCheck[],
  intervalSeconds: number,
): Promise<void> {
  await owned(db, job, async (c) => {
    for (const check of checks) {
      const component = lease.components.find((item) => item.software_key === check.software)!
      await saveComponentStatus(
        c,
        server.id,
        {
          [component.id]: {
            ...check.before,
            installed: check.before.state === 'installed',
            detail: 'detail' in check.before ? (check.before.detail ?? '') : '',
            revision: component.revision,
          },
        },
        [component],
      )
      const basis = {
        configRevision: String(server.config_revision),
        environmentRevision: String(server.environment_revision),
        definitionRevision: lease.signature,
        versions: component.versions,
        before: check.before,
      }
      await repository.ensurePolicy(c, server.id, check.software)
      await repository.saveCheck(c, {
        serverId: server.id,
        software: check.software,
        intervalSeconds,
        snapshot: JSON.stringify({ ...check, basis }),
        error:
          check.reason === 'detection_failed' || check.errors.length
            ? JSON.stringify({ reason: check.reason, errors: check.errors })
            : null,
      })
      await repository.obsoleteSuggestions(c, server.id, check.software)
      if (check.before.state !== 'installed') continue
      const from = check.before.version
      // Keep the highest candidate in each major-change path. Rejection cannot cause fallback to an older target.
      const chosen = [
        check.eligible.find((item) => !component.adapter.isMajorChange(from, item.version)),
        check.eligible.find((item) => component.adapter.isMajorChange(from, item.version)),
      ].filter((item): item is Candidate => !!item)
      for (const target of chosen)
        await repository.upsertSuggestion(c, {
          id: randomUUID(),
          serverId: server.id,
          software: check.software,
          targetIdentity: target.targetIdentity,
          version: target.version,
          candidate: JSON.stringify(target),
          basis: JSON.stringify(basis),
          reason: JSON.stringify({ major: component.adapter.isMajorChange(from, target.version) }),
        })
      await repository.satisfySuggestion(c, {
        serverId: server.id,
        software: check.software,
        targetIdentity: check.before.targetIdentity,
      })
    }
  })
}

export async function queueDetection(
  db: Db,
  ids: string[],
  automatic = false,
  intervalSeconds = 3600,
): Promise<void> {
  for (const id of ids)
    await transaction(db, async (c) => {
      const s = (await repository.lockServerRevision(c, id)).rows[0]
      if (!s) throw new ServerError('server_not_found')
      await repository.ensurePolicies(c, id)
      if ((await repository.activeDetection(c, id)).rows.length) return
      const job = randomUUID()
      await repository.insertDetection(c, {
        id: job,
        serverId: id,
        configRevision: s.config_revision,
        environmentRevision: s.environment_revision,
        operationId: randomUUID(),
        snapshot: JSON.stringify({ action: 'detect_updates', automatic, intervalSeconds }),
      })
      if (automatic) await repository.advanceChecks(c, id, intervalSeconds)
    })
}
