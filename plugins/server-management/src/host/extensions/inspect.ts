import type { Json } from '../../shared/contracts/common.ts'
import { ServerError } from '../../shared/errors.ts'
import { errorPayload } from '../../shared/i18n.ts'
import { scrubValue } from '../remote/parse.ts'
import { scriptCommand } from '../recipes/script.ts'
import type { WorkerContext } from '../execution/context.ts'
import { owned } from '../execution/ownership.ts'
import { readSettings } from './persistence/settings-repository.ts'
import { saveExtensionObservation } from './persistence/observation-repository.ts'
import type { ServerExtensionRegistry } from './registry.ts'

export interface ExtensionInspectionResult {
  key: string
  owner: string
  status: 'succeeded' | 'failed'
  result?: Json
  error?: Json
}

export type InspectionContext = Pick<WorkerContext, 'db' | 'job' | 'guard'> & {
  server: import('./runtime.ts').ExtensionInspectionServer
  session: Pick<WorkerContext['session'], 'exec'>
}

/** SSH runs without plugin callbacks retained; a withdrawn generation cannot publish its output. */
export async function runExtensionInspections(
  context: InspectionContext,
  extensions: ServerExtensionRegistry,
): Promise<ExtensionInspectionResult[]> {
  const entries = extensions.inspectionsFor(context.server)
  const manual = context.job.request_snapshot.source === 'manual'
  const results: ExtensionInspectionResult[] = []
  for (const entry of entries) {
    await context.guard()
    const inspection = extensions.inspection(entry.key)
    let item: ExtensionInspectionResult
    const releases: (() => void)[] = []
    try {
      extensions.assertCurrent(entry)
      if (inspection === undefined || inspection.entry !== entry)
        throw new ServerError('extension_inspection_unavailable', { key: entry.key })
      const settings = entry.settingsKey === undefined ? undefined : extensions.settings(context.server, entry.settingsKey)
      const section = settings === undefined ? undefined : entry.settingsKey!.slice(settings.entry.owner.length + 1)
      const stored = settings === undefined ? undefined
        : (await readSettings(context.db, context.server.id, settings.entry.owner, section!)).rows[0]
      const settingRevision = stored?.revision ?? '0'
      extensions.assertCurrent(entry)
      if (settings !== undefined) extensions.assertCurrent(settings.entry)
      if (!manual && inspection.runtime.enabled?.(stored?.value ?? settings?.runtime.defaults) === false) continue
      const response = await context.session.exec(scriptCommand(inspection.script), inspection.script.timeoutMs, {
        outputLimitBytes: inspection.script.outputLimitBytes,
      })
      if (response.code !== 0)
        throw new ServerError('extension_inspection_failed', { key: entry.key, detail: response.stderr.slice(-500) })
      releases.push(extensions.retain(entry))
      if (settings !== undefined) releases.push(extensions.retain(settings.entry))
      const result = inspection.runtime.validate(response.stdout)
      item = { key: entry.key, owner: entry.owner, status: 'succeeded', result }
      // owned() locks the server row. Every settings writer uses the same lock, even on first insert.
      await owned(context.db, context.job, async (client) => {
        if (settings !== undefined) {
          const latest = (await readSettings(client, context.server.id, settings.entry.owner, section!)).rows[0]
          if ((latest?.revision ?? '0') !== settingRevision)
            throw new ServerError('extension_inspection_setting_changed', { key: entry.key })
          extensions.assertCurrent(settings.entry)
        }
        extensions.assertCurrent(entry)
        await inspection.runtime.commit?.(client, context.server, result)
        await save(client, item)
        // Unload during an async callback rolls the whole observation/detail transaction back.
        extensions.assertCurrent(entry)
        if (settings !== undefined) extensions.assertCurrent(settings.entry)
      })
    } catch (cause) {
      if (cause instanceof ServerError && cause.code === 'job_lease_lost') throw cause
      item = {
        key: entry.key, owner: entry.owner, status: 'failed',
        error: errorPayload(cause instanceof ServerError ? cause : new ServerError('extension_inspection_failed', {
          key: entry.key, detail: cause instanceof Error ? cause.message : '',
        })),
      }
      await owned(context.db, context.job, (client) => save(client, item))
    } finally {
      for (const release of releases) release()
    }
    results.push(item)
  }
  return results

  async function save(client: import('../database/connection.ts').DbClient, item: ExtensionInspectionResult): Promise<void> {
    await saveExtensionObservation(client, {
      serverId: context.server.id, owner: item.owner, key: item.key, status: item.status,
      result: item.status === 'succeeded' ? (item.result ?? null) : null, error: item.error ?? null,
      configRevision: String(context.server.config_revision), definitionRevision: context.job.definition_revision,
    })
  }
}

export function extensionIssues(results: readonly ExtensionInspectionResult[]): ReturnType<typeof errorPayload>[] {
  return results
    .filter((item) => item.status === 'failed')
    .map((item) => item.error ?? errorPayload(new ServerError('extension_inspection_failed', { key: item.key })))
}

export function extensionResult(results: readonly ExtensionInspectionResult[]): Json {
  return results.map((item) => ({
    key: item.key,
    owner: item.owner,
    status: item.status,
    ...(item.result !== undefined ? { result: item.result } : {}),
    ...(item.error !== undefined ? { error: item.error } : {}),
  }))
}

export function scrubExtensionResults(results: readonly ExtensionInspectionResult[], secret: string) {
  return scrubValue(extensionResult(results), secret)
}
