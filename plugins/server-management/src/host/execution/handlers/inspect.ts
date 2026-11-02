import { ServerError } from '../../../shared/errors.ts'
import { errorPayload } from '../../../shared/i18n.ts'
import { preparePlan } from '../../recipes/planning.ts'
import { detectSoftware } from '../../recipes/software.ts'
import { scrubValue } from '../../remote/parse.ts'
import { saveObservation } from '../../servers/persistence/observation-repository.ts'
import { extensionIssues, runExtensionInspections, scrubExtensionResults } from '../../extensions/inspect.ts'
import { finishJob } from '../completion.ts'
import type { WorkerContext } from '../context.ts'
import { owned } from '../ownership.ts'
import { savePlan } from '../plans.ts'

export async function inspectJob(context: WorkerContext): Promise<void> {
  const { db, job, session, server, lease, probe, verified, secret } = context
  const status =
    lease && probe.state === 'detected'
      ? await detectSoftware(session, lease.components, probe.os)
      : undefined
  const extensionResults = context.extensions ? await runExtensionInspections(context, context.extensions) : []
  await owned(db, job, (client) =>
    saveObservation(
      client,
      server.id,
      job.id,
      status ? scrubValue(status, secret) : undefined,
      '',
      lease?.components ?? [],
    ),
  )
  if (!job.request_snapshot.prepare) {
    const issues: ReturnType<typeof errorPayload>[] = []
    if (probe.state === 'failed') issues.push(errorPayload(new ServerError('os_probe_failed')))
    if (!lease) issues.push(errorPayload(new ServerError('type_unavailable')))
    for (const [software, item] of Object.entries(status ?? {})) {
      if (item.state === 'unknown' || (item.state === 'installed' && item.healthy === false))
        issues.push(
          errorPayload(new ServerError('inspection_software_failed', { software, detail: item.detail })),
        )
    }
    issues.push(...extensionIssues(extensionResults))
    if (issues.length) {
      await finishJob(db, job, 'failed', '巡检发现检测异常。', {
        summary: 'inspection_issues',
        issues: scrubValue(issues, secret),
      })
      return
    }
  }
  if (job.request_snapshot.prepare && lease?.components.length) {
    if (probe.state !== 'detected') throw new ServerError('os_unverified')
    const plan = await preparePlan(session, lease, probe.os)
    if (plan.changes.some((change) => change.action === 'install')) await savePlan(db, job, server, plan)
  }
  await finishJob(
    db,
    job,
    'succeeded',
    job.request_snapshot.prepare ? '检查完成；缺失软件将按独立安装计划处理。' : '只读检查完成。',
    {
      summary: job.request_snapshot.prepare ? 'prepared' : 'inspected',
      ...(extensionResults.length ? { extensions: scrubExtensionResults(extensionResults, secret) } : {}),
    },
  )
}
