import { ServerError } from '../../../shared/errors.ts'
import { scrubValue } from '../../remote/parse.ts'
import { readPolicies } from '../../servers/persistence/policy-repository.ts'
import { detectUpdates } from '../../upgrades/detect.ts'
import { saveUpdateChecks } from '../../upgrades/detection.ts'
import { finishJob } from '../completion.ts'
import type { WorkerContext } from '../context.ts'

export async function detectUpdatesJob(context: WorkerContext): Promise<void> {
  const { db, job, session, server, lease, probe, verified, secret, updateCheckIntervalSeconds } = context

  if (!lease || probe.state !== 'detected' || verified !== 'matched') throw new ServerError('os_unverified')
  const enabled = job.request_snapshot.automatic
    ? (await readPolicies(db, server.id)).filter((p) => p.detect_updates).map((p) => p.software_key)
    : undefined
  const checks = await detectUpdates(session, lease, probe.os, enabled)
  await saveUpdateChecks(db, job, server, lease, scrubValue(checks, secret), updateCheckIntervalSeconds)
  const issues = checks.filter(
    (c) =>
      c.reason === 'detection_failed' ||
      c.reason === 'version_conflict' ||
      c.reason === 'unhealthy' ||
      c.errors.length,
  )
  await finishJob(
    db,
    job,
    issues.length ? 'failed' : 'succeeded',
    issues.length ? '升级检测发现异常。' : '升级检测完成；未执行软件变更。',
    { summary: 'updates_detected', checks: scrubValue(checks, secret) },
  )
}
