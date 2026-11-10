import { parseDocument } from 'yaml'
import { ApiError, commitSha, type OneDev } from './onedev.ts'

export interface DeliveryArgs {
  action: string
  project?: string
  ref?: string
  commit?: string
  job?: string
  status?: string
  offset?: number
  count?: number
  params?: unknown
  buildId?: number
  path?: string
}
interface Parameter { name: string; type: string; required: boolean; defaultValue: string[] | null }
interface Job { name: string; executor: string | null; parameters: Parameter[] }

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, 'invalid_build_spec')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new ApiError(422, 'invalid_build_spec')
  return value
}
export function parseJobs(content: string): { jobs: Job[]; complete: boolean; limitations: string[] } {
  const document = parseDocument(content, { uniqueKeys: true })
  if (document.errors.length || document.warnings.length) throw new ApiError(422, 'unsupported_build_spec_syntax')
  let parsed: unknown
  try { parsed = document.toJS({ maxAliasCount: 50 }) }
  catch (cause) { throw new ApiError(422, 'invalid_build_spec', { cause }) }
  const spec = record(parsed)
  if (!Array.isArray(spec.jobs)) throw new ApiError(422, 'invalid_build_spec')
  const jobs = spec.jobs.map(raw => {
    const job = record(raw)
    const params = job.paramSpecs ?? []
    if (!Array.isArray(params)) throw new ApiError(422, 'invalid_build_spec')
    return {
      name: text(job.name), executor: typeof job.jobExecutor === 'string' ? job.jobExecutor : null,
      parameters: params.map(rawParam => {
        const param = record(rawParam)
        const provider = param.defaultValueProvider
        const value = provider && typeof provider === 'object' ? record(provider) : null
        const literal = value?.type === 'SpecifiedDefaultValue' ? value.value : undefined
        const type = text(param.type)
        return { name: text(param.name), type, required: param.allowEmpty !== true && provider == null,
          defaultValue: type === 'SecretParam' || literal === undefined ? null : Array.isArray(literal) ? literal.map(String) : [String(literal)] }
      }),
    }
  })
  if (new Set(jobs.map(job => job.name)).size !== jobs.length) throw new ApiError(422, 'duplicate_job_name')
  const imports = spec.imports
  const complete = imports === undefined || (Array.isArray(imports) && imports.length === 0)
  return { jobs, complete, limitations: complete ? ['Parsed repository YAML; OneDev validates executability and dynamic defaults when submitting.'] : ['Imported jobs are not resolved; run_job is disabled for this build spec.'] }
}

export function queryQuote(value: string): string {
  if (/[\x00-\x1f\x7f*?]/.test(value)) throw new ApiError(400, 'invalid_build_filter')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}
function page(value: number | undefined, fallback: number, max: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 0 || result > max) throw new ApiError(400, 'invalid_pagination')
  return result
}
function refFilter(ref: string): string {
  const tag = ref.startsWith('refs/tags/')
  const value = ref.replace(/^refs\/(heads|tags)\//, '')
  if (ref.startsWith('refs/') && !/^refs\/(heads|tags)\//.test(ref)) throw new ApiError(400, 'invalid_ref')
  return `${tag ? '"Tag"' : '"Branch"'} is ${queryQuote(value)}`
}
export async function listBuilds(one: OneDev, args: DeliveryArgs) {
  const filters: string[] = []
  const project = args.project ? await one.projectByName(args.project) : null
  if (args.project && project === null) throw new ApiError(404, 'project_not_found')
  if (project) filters.push(`"Project" is ${queryQuote(project.path)}`)
  if (args.commit) {
    if (!project) throw new ApiError(400, 'project_required_for_commit')
    filters.push(`"Commit" is ${queryQuote(`${project.path}:${commitSha(args.commit)}`)}`)
  }
  if (args.job) filters.push(`"Job" is ${queryQuote(args.job)}`)
  if (args.ref) filters.push(refFilter(args.ref))
  if (args.status) {
    const statuses: Record<string, string> = { SUCCESSFUL: 'successful', FAILED: 'failed', RUNNING: 'running', WAITING: 'waiting', PENDING: 'pending', CANCELLED: 'cancelled', TIMED_OUT: 'timed out' }
    const status = statuses[args.status]
    if (!status) throw new ApiError(400, 'invalid_build_status')
    filters.push(status)
  }
  const offset = page(args.offset, 0, 1_000_000)
  const count = page(args.count, 20, 100)
  if (count === 0) throw new ApiError(400, 'invalid_pagination')
  const builds = await one.builds(offset, count, filters.join(' and '))
  const names = project ? new Map([[project.id, project.name]]) : await one.projectNames()
  return { builds: builds.map(build => ({ ...build, projectName: names.get(build.projectId) ?? `#${build.projectId}` })),
    offset, count, nextOffset: builds.length === count ? offset + count : null, complete: builds.length < count }
}

async function selectedJobs(one: OneDev, args: DeliveryArgs) {
  if (!args.project) throw new ApiError(400, 'project_required')
  const project = await one.projectByName(args.project)
  if (!project) throw new ApiError(404, 'project_not_found')
  const ref = args.ref || (await one.repository(project.id)).defaultBranch
  if (!ref) throw new ApiError(409, 'repository_not_initialized')
  let refName: string
  let current: string
  if (ref.startsWith('refs/heads/')) {
    refName = ref; current = await one.resolve(project.id, 'branch', ref.slice(11))
  } else if (ref.startsWith('refs/tags/')) {
    refName = ref; current = await one.resolve(project.id, 'tag', ref.slice(10))
  } else {
    if (ref.startsWith('refs/')) throw new ApiError(400, 'invalid_ref')
    try { current = await one.resolve(project.id, 'branch', ref); refName = `refs/heads/${ref}` }
    catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 404) throw cause
      current = await one.resolve(project.id, 'tag', ref); refName = `refs/tags/${ref}`
    }
  }
  const commit = args.commit ? commitSha(args.commit) : current
  if (commit !== current) throw new ApiError(409, 'ref_commit_changed')
  const file = await one.file(project.id, commit, '.onedev-buildspec.yml')
  if (file.partial || file.size > 1024 * 1024) throw new ApiError(413, 'build_spec_too_large')
  return { project, ref: refName, commit, ...parseJobs(file.bytes.toString('utf8')) }
}

export async function deliveryAction(one: OneDev, args: DeliveryArgs, authorize: () => Promise<void>) {
  if (args.action === 'list_builds') return listBuilds(one, args)
  if (args.action === 'get_build_artifact') {
    const id = args.buildId
    if (!id || !Number.isSafeInteger(id) || id < 1) throw new ApiError(400, 'invalid_build_id')
    const build = await one.build(id)
    if (build.status !== 'SUCCESSFUL') throw new ApiError(409, 'build_not_successful')
    const path = args.path ?? 'image.json'
    const content = await one.artifact(id, path)
    if (path === 'image.json') {
      const image = record(content)
      if (image.commit !== build.commitHash || String(image.build) !== String(build.number)) throw new ApiError(409, 'artifact_build_mismatch')
      if (typeof image.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(image.digest)) throw new ApiError(422, 'invalid_image_digest')
      if (typeof image.registry !== 'string' || !/^[a-z0-9.-]+(?::\d+)?\/[a-z0-9._/-]+:[A-Za-z0-9_.-]+$/.test(image.registry)) throw new ApiError(422, 'invalid_image_repository')
      return { buildId: id, projectId: build.projectId, commit: build.commitHash, path, content,
        digestAddress: `${image.registry.slice(0, image.registry.lastIndexOf(':'))}@${image.digest}` }
    }
    return { buildId: id, projectId: build.projectId, commit: build.commitHash, path, content }
  }
  if (args.action === 'run_job' && (!args.commit || !args.ref)) throw new ApiError(400, 'commit_and_ref_required')
  const selection = await selectedJobs(one, args)
  if (args.action === 'list_jobs') return { ...selection, project: selection.project.path, source: 'repository-buildspec' }
  if (!selection.complete) throw new ApiError(422, 'imported_jobs_not_supported')
  const job = selection.jobs.find(job => job.name === args.job)
  if (!job) throw new ApiError(404, 'job_not_found')
  const params = record(args.params ?? {})
  for (const [key, value] of Object.entries(params)) {
    const parameter = job.parameters.find(param => param.name === key)
    if (!parameter || parameter.type === 'SecretParam' || !Array.isArray(value) || value.some(v => typeof v !== 'string' || v.length > 4096)) throw new ApiError(400, 'invalid_job_parameters')
  }
  // Explicit parameter values make reusing an existing build unambiguous.
  for (const parameter of job.parameters) {
    if (parameter.type === 'SecretParam') throw new ApiError(422, 'secret_job_parameters_not_supported')
    if (!(parameter.name in params)) {
      if (parameter.defaultValue !== null) params[parameter.name] = parameter.defaultValue
      else if (parameter.required) throw new ApiError(400, 'missing_job_parameter')
      else throw new ApiError(422, 'explicit_job_parameter_required')
    }
  }
  const existing = await listBuilds(one, { action: 'list_builds', project: selection.project.path, job: job.name, commit: selection.commit, ref: selection.ref, count: 100 })
  for (const build of existing.builds) {
    const values = await one.request(`builds/${build.id}/params`)
    if (!Array.isArray(values)) throw new ApiError(502, 'invalid_upstream')
    const actual: Record<string, string[]> = {}
    for (const item of values) {
      const row = record(item)
      if (typeof row.name !== 'string' || typeof row.value !== 'string') throw new ApiError(502, 'invalid_upstream')
      ;(actual[row.name] ??= []).push(row.value)
    }
    const keys = Object.keys(params).sort()
    if (JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(keys) && keys.every(key => JSON.stringify([...actual[key]].sort()) === JSON.stringify([...(params[key] as string[])].sort())))
      return { reused: true, buildId: build.id, ...build }
  }
  if (!existing.complete) throw new ApiError(409, 'build_lookup_incomplete')
  await authorize()
  let id: unknown
  try { id = await one.post('job-runs', { '@type': 'JobRunOnCommit', projectId: selection.project.id, commitHash: selection.commit, refName: selection.ref, jobName: job.name, params, reason: 'Harness project delivery' }) }
  catch (cause) {
    if (cause instanceof ApiError && cause.status < 500) throw cause
    throw new ApiError(502, 'job_submission_uncertain_check_builds_before_retry', { cause })
  }
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new ApiError(502, 'job_submission_uncertain_check_builds_before_retry')
  let build
  try { build = await one.build(id) }
  catch (cause) { throw new ApiError(502, `job_submitted_build_${id}_query_required`, { cause }) }
  if (build.commitHash !== selection.commit || build.projectId !== selection.project.id || build.jobName !== job.name) throw new ApiError(409, 'submitted_build_mismatch')
  return { reused: false, buildId: id, ...build }
}
