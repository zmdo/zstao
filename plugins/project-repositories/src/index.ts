import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { deliveryAction, type DeliveryArgs } from './delivery.ts'
import { authorizeBuild, authorizeProjectOperation } from './delivery-authorization.ts'
import { ApiError, OneDev, commitSha, decryptPassword, imageType, preview, projectId, repositoryPath } from './onedev.ts'
import { tcrDeleteTag, tcrRepositories, tcrTags, tcrTag, ensurePrivateRepository, type TcrSettings } from './tcr.ts'
import { BOOTSTRAP_DEFAULTS, bootstrapSettings, projectPath, resolveProject, createManagedProject, projectContext, buildEnvironment, managedProject, type BootstrapSettings } from './bootstrap.ts'
import type { Secrets } from './onedev.ts'
import { API, DOWNLOAD_BYTES } from './shared.ts'

interface HostCtx {
  get?(name: string): unknown
  provide(name: string, service: unknown): () => void | Promise<void>
  consoleSession: { read(cookieHeader: string): Promise<unknown> }
  secrets: Secrets
  webServer: { register(route: { kind: 'prefix'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }
  tools: { register(tool: unknown): () => void }
  systemPrompt: { section(section: { name: string; order: number; text: string }): () => void }
  effect(run: () => (() => void | Promise<void>)): void
}
interface Settings extends BootstrapSettings { internalBaseUrl: string; externalBaseUrl: string; username: string; passwordCiphertext: string; updatedAt: string | null }
export const inject = ['consoleSession', 'secrets', 'webServer', 'tools', 'systemPrompt']

export function apply(ctx: HostCtx): void {
  const file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'project-management.json')
  ctx.effect(() => ctx.provide('imageRegistry', {
    async pullLogin() {
      const settings = await readImageSettings(join(dirname(file), 'image-registry.json'))
      if (!settings.applicationServerPull || !settings.username || !settings.passwordCiphertext) throw new ApiError(409, 'application_pull_not_configured')
      if (!/^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i.test(settings.registry) || /[\r\n\0:]/.test(settings.username)) throw new ApiError(409, 'application_pull_not_configured')
      return { registry: settings.registry, username: settings.username, password: ctx.secrets.decrypt(settings.passwordCiphertext) }
    },
  }))

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'smp-project-repositories:git',
    order: 2500,
    text:
      'For a new software project, call platform_onedev action=create_project with a lowercase project slug and description. It creates a repository in the configured managed project space, or reuses the existing project. Use the full project.path returned by tools for later calls. ' +
      'Use the returned git connection, SSH command, identity and readiness fields; never invent a repository address or derive SSH settings from a web URL. If access is incomplete, retry create_project for the same project to finish it. Do not read private keys or registry credentials. ' +
      'When asked to create an application and deploy it, load the project-delivery skill and call prepare_delivery for the new project to obtain the build executor, base image and private image repository. Use existing project configuration when continuing an existing app. ' +
      'Implement the requested application and tests, commit and push with normal Git commands. Use list_jobs/run_job with explicit ref and commit, then get_build_artifact after success. Check list_builds before retrying uncertain submissions. Deploy only to the user-selected managed server through platform_server tools. Never delete projects or replace the AI login key.',
  }))

  ctx.effect(() => {
    const stop = ctx.tools.register(defineTool({
      name: 'platform_onedev',
      description:
        'OneDev actions: list_projects, get_project, list_branches, list_tags, list_commits, get_tree, get_file, list_builds, get_build, get_build_logs, list_jobs, run_job, get_build_artifact, create_project, prepare_delivery. ' +
        'Use create_project for a new project: it creates in the managed space, returns Git connection info and repairs incomplete AI access there. Existing unmanaged projects are returned without changing access. Use prepare_delivery before the first build/deployment of a managed project; it checks the build environment and ensures a private TCR repository, returning executor, image and template defaults. ' +
        'Use list_jobs before run_job; run_job requires an explicit ref and commit SHA, reuses existing matching builds, and never automatically retries an uncertain submission. Read image.json with get_build_artifact after success. Imported build specs are not supported for submission. ' +
        'Use the other actions to discover and inspect projects. This tool never deletes projects or changes the AI login key.',
      parameters: {
        action: {
          type: 'string', required: true,
          enum: ['list_projects', 'get_project', 'list_branches', 'list_tags', 'list_commits', 'get_tree', 'get_file', 'list_builds', 'get_build', 'get_build_logs', 'list_jobs', 'run_job', 'get_build_artifact', 'create_project', 'prepare_delivery'],
          description: 'Operation to perform.',
        },
        project: { type: 'string', description: 'OneDev full project path (for example apps/todo). create_project also accepts a new lowercase slug. Use returned project.path for subsequent actions.' },
        ref: { type: 'string', description: 'Branch or tag name. Defaults to the default branch for code reads.' },
        path: { type: 'string', description: 'Repository path or JSON artifact path; get_build_artifact defaults to image.json.' },
        commit: { type: 'string', description: 'Full 40-character commit SHA. Required for run_job; optional expected head for list_jobs or filter for list_builds.' },
        offset: { type: 'integer', description: 'Build pagination offset, defaults to 0. Follow nextOffset until null.' },
        params: { type: 'object', additionalProperties: true, description: 'Job parameters as a map of names to arrays of strings. Never pass plaintext secrets.' },
        query: { type: 'string', description: 'Optional case-insensitive project search for list_projects.' },
        description: { type: 'string', description: 'Project description for create_project.' },
        buildId: { type: 'integer', description: 'OneDev build id for get_build, get_build_logs or get_build_artifact.' },
        status: { type: 'string', enum: ['WAITING', 'PENDING', 'RUNNING', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'SUCCESSFUL'], description: 'Optional build status filter for list_builds.' },
        job: { type: 'string', description: 'Job name for run_job or optional filter for list_builds.' },
        count: { type: 'integer', description: 'Maximum builds to return for list_builds, 1-100. Defaults to 20.' },
      },
      output: { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] },
      timeoutMs: 60_000,
      async execute(args: DeliveryArgs & { query?: string; description?: string }, exec: ToolRunContext) {
        const action = args.action
        const name = (args.project ?? '').trim()
        const settings = await readSettings(file)
        const one = new OneDev(settings, ctx.secrets, exec.signal)
        if (action === 'list_projects') {
          const projects = await one.projects(0)
          const query = (args.query ?? '').trim().toLowerCase()
          const filtered = projects.filter(project => query === '' || `${project.name} ${project.path} ${project.description}`.toLowerCase().includes(query))
          return JSON.stringify({
            projects: filtered.map(project => ({
              id: project.id, name: project.name, path: project.path, description: project.description,
              webUrl: project.webUrl, lastUpdated: project.lastUpdated, codeManagement: project.codeManagement,
            })),
          })
        }
        if (['list_builds', 'list_jobs', 'run_job', 'get_build_artifact'].includes(action)) {
          if (args.project) {
            const selected = await resolveProject(one, args.project, settings)
            if (!selected) throw new ApiError(404, 'project_not_found')
            args = { ...args, project: selected.path }
          }
          return JSON.stringify(await deliveryAction(one, args, () => authorizeBuild(ctx, exec, name, args.job ?? '', args.commit ?? '')))
        }
        if (action === 'get_build' || action === 'get_build_logs') {
          const id = args.buildId
          if (id === undefined || !Number.isSafeInteger(id) || id < 1) throw new ApiError(400, 'invalid_build_id')
          if (action === 'get_build_logs') return JSON.stringify({ buildId: id, text: await one.buildLogs(id) })
          const [build, projectNames] = await Promise.all([one.build(id), one.projectNames()])
          return JSON.stringify({ ...build, projectName: projectNames.get(build.projectId) ?? `#${build.projectId}` })
        }
        projectPath(name)
        if (action === 'create_project') {
          const result = await createManagedProject(one, name, (args.description ?? '').trim().slice(0, 500), settings,
            () => authorizeProjectOperation(ctx, exec, `Create or finish managed project ${name}`, `创建或补齐项目 ${name}？`))
          const context = await projectContext(one, result.project, settings, dirname(file), await readImageSettings(join(dirname(file), 'image-registry.json')))
          return JSON.stringify({ ...result, ...context, ready: result.repositoryReady && result.access.ready === true && context.git.configured })
        }
        const project = await resolveProject(one, name, settings)
        if (project === null) throw new ApiError(404, 'project_not_found')
        if (action === 'prepare_delivery') {
          if (!managedProject(project.path, settings)) throw new ApiError(409, 'use_existing_project_delivery_configuration')
          const context = await projectContext(one, project, settings, dirname(file), await readImageSettings(join(dirname(file), 'image-registry.json')))
          if (!context.git.configured) return JSON.stringify({ project: project.path, prepared: false, ...context })
          const environment = await buildEnvironment(one, settings)
          await authorizeProjectOperation(ctx, exec, `Prepare private image repository for ${project.path}`, `准备项目 ${project.path} 的私有镜像仓库？`)
          const images = tcrSettings(await readImageSettings(join(dirname(file), 'image-registry.json')), ctx.secrets)
          const repository = await ensurePrivateRepository(images, project.id, exec.signal)
          return JSON.stringify({ project: project.path, projectId: project.id, prepared: true, ...context, buildEnvironment: environment,
            image: { ...repository, address: `${images.registry}/${repository.repository}`, private: true, pushVerified: false },
            next: 'Use the project-delivery skill templates, adapt to the application, test and push a commit. Actual build/push/pull validate the credentials.' })
        }
        const repo = await one.repository(project.id)
        if (action === 'get_project') {
          return JSON.stringify({
            project: { id: project.id, name: project.name, path: project.path, description: project.description, webUrl: project.webUrl, lastUpdated: project.lastUpdated },
            defaultBranch: repo.defaultBranch, branches: repo.branches, tags: repo.tags, cloneUrl: repo.cloneUrl, cloneUrls: repo.cloneUrls,
            ...await projectContext(one, project, settings, dirname(file), await readImageSettings(join(dirname(file), 'image-registry.json'))),
          })
        }
        if (action === 'list_branches') return JSON.stringify({ project: project.name, branches: repo.branches })
        if (action === 'list_tags') return JSON.stringify({ project: project.name, tags: repo.tags })
        const ref = (args.ref ?? repo.defaultBranch ?? '').trim()
        if (ref === '') throw new ApiError(409, 'repository_not_initialized')
        let sha: string
        try {
          sha = await one.resolve(project.id, 'branch', ref)
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 404) throw cause
          sha = await one.resolve(project.id, 'tag', ref)
        }
        if (action === 'list_commits') return JSON.stringify({ project: project.name, ref, sha, ...(await one.commits(project.id, sha)) })
        const path = (args.path ?? '').trim()
        if (action === 'get_tree') {
          const tree = await one.tree(project.id, sha, repositoryPath(path, true))
          return JSON.stringify({ project: project.name, ref, sha, path, ...tree })
        }
        if (action === 'get_file') {
          const filePath = repositoryPath(path, false)
          const filePreview = preview(await one.file(project.id, sha, filePath))
          return JSON.stringify({ project: project.name, ref, sha, ...filePreview })
        }
        throw new ApiError(400, 'unknown_action')
      },
    }))
    return stop
  })

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'platform_image_registry',
    description:
      'Read the CES image registry backed by Tencent Cloud TCR. ' +
      'Use action=list_repositories to discover repositories, action=list_tags to list tags of a repository, and action=get_tag to resolve one tag to its tag and digest image addresses. ' +
      'This tool is read-only; it never deletes repositories or images.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list_repositories', 'list_tags', 'get_tag'], description: 'Operation to perform.' },
      repository: { type: 'string', description: 'Repository name such as zstao/ces-integration. Required for list_tags and get_tag; optional search for list_repositories.' },
      tag: { type: 'string', description: 'Image tag for get_tag.' },
      offset: { type: 'integer', description: 'Pagination offset. Defaults to 0.' },
      count: { type: 'integer', description: 'Maximum entries, 1-100. Defaults to 20.' },
    },
    output: { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] },
    timeoutMs: 30_000,
    async execute(args: { action: string; repository?: string; tag?: string; offset?: number; count?: number }, exec: { signal: AbortSignal }) {
      const offset = args.offset ?? 0
      const count = Math.min(100, Math.max(1, args.count ?? 20))
      if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400, 'invalid_offset')
      const repository = (args.repository ?? '').trim()
      const settings = tcrSettings(await readImageSettings(join(dirname(file), 'image-registry.json')), ctx.secrets)
      if (args.action === 'list_repositories') {
        const result = await tcrRepositories(settings, offset, count, exec.signal, repository)
        return JSON.stringify({
          registry: result.server, namespace: settings.namespace, total: result.total,
          repositories: result.repositories.map(repo => ({
            name: repo.name, tagCount: repo.tagCount, public: repo.public, pullCount: repo.pullCount,
            creationTime: repo.creationTime, updateTime: repo.updateTime, description: repo.description,
          })),
        })
      }
      if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(repository)) throw new ApiError(400, 'invalid_repository')
      if (args.action === 'list_tags') {
        const result = await tcrTags(settings, repository, offset, count, exec.signal)
        return JSON.stringify({
          registry: settings.registry, repository, total: result.total,
          tags: result.tags.map(tag => ({
            name: tag.name, digest: tag.digest, size: tag.size, os: tag.os, architecture: tag.architecture,
            created: tag.created, pushed: tag.pushed,
            address: `${settings.registry}/${repository}:${tag.name}`,
            digestAddress: `${settings.registry}/${repository}@${tag.digest}`,
          })),
        })
      }
      if (args.action === 'get_tag') {
        const tagName = (args.tag ?? '').trim()
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tagName)) throw new ApiError(400, 'invalid_tag')
        const tag = await tcrTag(settings, repository, tagName, exec.signal)
        return JSON.stringify({
          registry: settings.registry, repository, tag: tag.name, digest: tag.digest, size: tag.size,
          os: tag.os, architecture: tag.architecture, pushed: tag.pushed,
          address: `${settings.registry}/${repository}:${tag.name}`,
          digestAddress: `${settings.registry}/${repository}@${tag.digest}`,
        })
      }
      throw new ApiError(400, 'unknown_action')
    },
  })))

  ctx.effect(() => {
    const shutdown = new AbortController()
    const pending = new Set<Promise<void>>()
    let reveals: number[] = []
    const stop = ctx.webServer.register({ kind: 'prefix', path: API, handler(request, response) {
      const disconnected = new AbortController()
      const close = () => disconnected.abort()
      response.on('close', close)
      const signal = AbortSignal.any([shutdown.signal, disconnected.signal])
      const task = handle(ctx, file, request, response, signal, () => {
        const now = Date.now()
        reveals = reveals.filter(at => now - at < 60_000)
        if (reveals.length >= 10) throw new ApiError(429, 'rate_limited')
        reveals.push(now)
      }).finally(() => { pending.delete(task); response.off('close', close) })
      pending.add(task)
      return task
    } })
    return async () => {
      stop()
      shutdown.abort()
      await Promise.allSettled([...pending])
    }
  })
}

interface ImageRegistrySettings {
  applicationServerPull: boolean
  registry: string
  namespace: string
  region: string
  secretIdCiphertext: string
  secretKeyCiphertext: string
  username: string
  passwordCiphertext: string
  updatedAt: string | null
}

const IMAGE_REGISTRY_DEFAULT = 'ccr.ccs.tencentyun.com'
const TCR_REGION = 'ap-beijing'

async function readImageSettings(file: string): Promise<ImageRegistrySettings> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid')
    const row = value as Record<string, unknown>
    return {
      applicationServerPull: row.applicationServerPull === true,
      registry: typeof row.registry === 'string' ? row.registry : IMAGE_REGISTRY_DEFAULT,
      namespace: typeof row.namespace === 'string' ? row.namespace : '',
      region: typeof row.region === 'string' ? row.region : TCR_REGION,
      secretIdCiphertext: typeof row.secretIdCiphertext === 'string' ? row.secretIdCiphertext : '',
      secretKeyCiphertext: typeof row.secretKeyCiphertext === 'string' ? row.secretKeyCiphertext : '',
      username: typeof row.username === 'string' ? row.username : '',
      passwordCiphertext: typeof row.passwordCiphertext === 'string' ? row.passwordCiphertext : '',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    }
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return { applicationServerPull: false, registry: IMAGE_REGISTRY_DEFAULT, namespace: '', region: TCR_REGION, secretIdCiphertext: '', secretKeyCiphertext: '', username: '', passwordCiphertext: '', updatedAt: null }
    }
    throw new ApiError(500, 'image_registry_settings_unavailable', { cause })
  }
}

function imageRegistryPublic(settings: ImageRegistrySettings): Record<string, unknown> {
  return {
    applicationServerPull: settings.applicationServerPull,
    pullConfigured: settings.applicationServerPull && !!settings.username && !!settings.passwordCiphertext,
    registry: settings.registry,
    namespace: settings.namespace,
    region: settings.region,
    username: settings.username,
    configured: settings.namespace !== '' && settings.secretIdCiphertext !== '' && settings.secretKeyCiphertext !== '',
    secretId: settings.secretIdCiphertext === '' ? '' : '已配置',
    secretKey: settings.secretKeyCiphertext === '' ? '' : '已配置',
    password: settings.passwordCiphertext === '' ? '' : '已配置',
    updatedAt: settings.updatedAt,
  }
}

function tcrSettings(settings: ImageRegistrySettings, secrets: { decrypt(value: string): string }): TcrSettings {
  if (settings.namespace === '' || settings.secretIdCiphertext === '' || settings.secretKeyCiphertext === '') throw new ApiError(409, 'image_registry_not_configured')
  return {
    registry: settings.registry,
    namespace: settings.namespace,
    region: settings.region,
    secretId: secrets.decrypt(settings.secretIdCiphertext),
    secretKey: secrets.decrypt(settings.secretKeyCiphertext),
  }
}

async function writeImageSettings(file: string, settings: ImageRegistrySettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = join(dirname(file), `.image-registry-${randomUUID()}.json`)
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, file)
}

async function readSettings(file: string): Promise<Settings> {
  let content: string
  try { content = await readFile(file, 'utf8') } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return { ...BOOTSTRAP_DEFAULTS, internalBaseUrl: '', externalBaseUrl: '', username: 'admin', passwordCiphertext: '', updatedAt: null }
    throw new ApiError(500, 'settings_unavailable', { cause })
  }
  let value: unknown
  try { value = JSON.parse(content) } catch (cause) { throw new ApiError(500, 'settings_unavailable', { cause }) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(500, 'settings_unavailable')
  const row = value as Record<string, unknown>
  const internal = typeof row.internalBaseUrl === 'string' ? row.internalBaseUrl : typeof row.baseUrl === 'string' ? row.baseUrl : ''
  if (!internal || typeof row.username !== 'string' || typeof row.passwordCiphertext !== 'string') throw new ApiError(500, 'settings_unavailable')
  return { ...bootstrapSettings(row), internalBaseUrl: normalizeBaseUrl(internal), externalBaseUrl: normalizeBaseUrl(typeof row.externalBaseUrl === 'string' && row.externalBaseUrl ? row.externalBaseUrl : internal), username: row.username,
    passwordCiphertext: row.passwordCiphertext, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null }
}
function publicSettings(settings: Settings) {
  return { ...bootstrapSettings({ ...settings }), internalBaseUrl: settings.internalBaseUrl, externalBaseUrl: settings.externalBaseUrl, username: settings.username, configured: settings.passwordCiphertext !== '', updatedAt: settings.updatedAt }
}
function sameOriginJson(request: IncomingMessage): void {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new ApiError(415, 'json_required')
  const site = request.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new ApiError(403, 'origin_rejected')
  const origin = request.headers.origin
  if (origin !== undefined) {
    let parsed: URL
    try { parsed = new URL(origin) } catch (cause) { throw new ApiError(403, 'origin_rejected', { cause }) }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== request.headers.host) throw new ApiError(403, 'origin_rejected')
  }
}
async function handle(ctx: HostCtx, file: string, request: IncomingMessage, response: ServerResponse, signal: AbortSignal, reveal: () => void): Promise<void> {
  try {
    const cookie = request.headers.cookie
    if (await ctx.consoleSession.read(Array.isArray(cookie) ? cookie.join('; ') : cookie ?? '') === undefined) throw new ApiError(401, 'auth_required')
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${API}/`)) throw new ApiError(404, 'not_found')
    const path = url.pathname.slice(API.length)
    if (path === '/settings/ai-identity') {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
      let publicKey = ''
      try { publicKey = (await readFile(join(dirname(file), 'keys', 'cesai.pub'), 'utf8')).trim() } catch (cause) { void cause }
      send(response, 200, { username: 'cesai', email: 'cesai@dianzinao.cn', publicKey, privateKeyPath: join(dirname(file), 'keys', 'cesai') })
      return
    }
    if (path === '/settings') {
      if (request.method === 'GET') { send(response, 200, publicSettings(await readSettings(file))); return }
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
      sameOriginJson(request)
      const body = await readJson(request)
      const internalBaseUrl = normalizeBaseUrl(typeof body.internalBaseUrl === 'string' ? body.internalBaseUrl : typeof body.baseUrl === 'string' ? body.baseUrl : '')
      const externalBaseUrl = normalizeBaseUrl(typeof body.externalBaseUrl === 'string' && body.externalBaseUrl.trim() ? body.externalBaseUrl : internalBaseUrl)
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      if (!username || username.includes(':') || /[\r\n]/.test(username)) throw new ApiError(400, 'invalid_username')
      const previous = await readSettings(file)
      const password = typeof body.password === 'string' ? body.password : ''
      const passwordCiphertext = password === '' ? previous.passwordCiphertext : ctx.secrets.encrypt(password)
      if (!passwordCiphertext) throw new ApiError(400, 'password_required')
      const next = { ...bootstrapSettings({ ...previous, ...body }), internalBaseUrl, externalBaseUrl, username, passwordCiphertext, updatedAt: new Date().toISOString() }
      await mkdir(dirname(file), { recursive: true })
      const temporary = join(dirname(file), `.project-management-${randomUUID()}.json`)
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, file)
      send(response, 200, publicSettings(next))
      return
    }
    if (path === '/settings/reveal-password') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
      sameOriginJson(request)
      reveal()
      const settings = await readSettings(file)
      send(response, 200, { password: decryptPassword(settings, ctx.secrets) })
      return
    }
    if (path === '/image-registry/settings') {
      const settings = await readImageSettings(join(dirname(file), 'image-registry.json'))
      if (request.method === 'GET') { send(response, 200, imageRegistryPublic(settings)); return }
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
      sameOriginJson(request)
      const body = await readJson(request)
      const registry = typeof body.registry === 'string' ? body.registry.trim().replace(/^https?:\/\//, '') : ''
      const namespace = typeof body.namespace === 'string' ? body.namespace.trim() : ''
      if (!/^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i.test(registry)) throw new ApiError(400, 'invalid_registry')
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(namespace)) throw new ApiError(400, 'invalid_namespace')
      const secretId = typeof body.secretId === 'string' ? body.secretId.trim() : ''
      const secretKey = typeof body.secretKey === 'string' ? body.secretKey : ''
      const secretIdCiphertext = secretId === '' ? settings.secretIdCiphertext : ctx.secrets.encrypt(secretId)
      const secretKeyCiphertext = secretKey === '' ? settings.secretKeyCiphertext : ctx.secrets.encrypt(secretKey)
      if ((secretIdCiphertext === '') !== (secretKeyCiphertext === '')) throw new ApiError(400, 'image_registry_credentials_required')
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (body.applicationServerPull !== undefined && typeof body.applicationServerPull !== 'boolean') throw new ApiError(400, 'invalid_request')
      const applicationServerPull = body.applicationServerPull === undefined ? settings.applicationServerPull : body.applicationServerPull === true
      if (applicationServerPull && (!username || /[\r\n\0:]/.test(username) || (!password && !settings.passwordCiphertext))) throw new ApiError(400, 'application_pull_not_configured')
      const next: ImageRegistrySettings = {
        applicationServerPull, registry, namespace, region: TCR_REGION,
        secretIdCiphertext, secretKeyCiphertext, username,
        passwordCiphertext: password === '' ? settings.passwordCiphertext : ctx.secrets.encrypt(password),
        updatedAt: new Date().toISOString(),
      }
      // Docker credentials can be configured independently of the TCR management API.
      // Connectivity is checked by the Test API action or the target's docker login.
      await writeImageSettings(join(dirname(file), 'image-registry.json'), next)
      send(response, 200, imageRegistryPublic(next))
      return
    }
    if (path === '/image-registry/test') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
      sameOriginJson(request)
      const base = await readImageSettings(join(dirname(file), 'image-registry.json'))
      const body = await readJson(request)
      const registry = typeof body.registry === 'string' && body.registry.trim() !== '' ? body.registry.trim().replace(/^https?:\/\//, '') : base.registry
      const namespace = typeof body.namespace === 'string' && body.namespace.trim() !== '' ? body.namespace.trim() : base.namespace
      const secretId = typeof body.secretId === 'string' && body.secretId.trim() !== '' ? body.secretId.trim() : ctx.secrets.decrypt(base.secretIdCiphertext)
      const secretKey = typeof body.secretKey === 'string' && body.secretKey !== '' ? body.secretKey : ctx.secrets.decrypt(base.secretKeyCiphertext)
      if (namespace === '' || secretId === '' || secretKey === '') throw new ApiError(409, 'image_registry_not_configured')
      const result = await tcrRepositories({ registry, namespace, region: TCR_REGION, secretId, secretKey }, 0, 1, signal)
      send(response, 200, { ok: true, repositoryCount: result.total, server: result.server })
      return
    }
    if (path === '/image-registry/repositories') {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
      const rawOffset = url.searchParams.get('offset') ?? '0'
      const rawLimit = url.searchParams.get('limit') ?? '20'
      if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset)) || Number(rawOffset) > 1_000_000) throw new ApiError(400, 'invalid_offset')
      if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1 || Number(rawLimit) > 100) throw new ApiError(400, 'invalid_limit')
      const settings = tcrSettings(await readImageSettings(join(dirname(file), 'image-registry.json')), ctx.secrets)
      const repo = (url.searchParams.get('repo') ?? '').trim()
      const result = await tcrRepositories(settings, Number(rawOffset), Number(rawLimit), signal, repo)
      send(response, 200, result)
      return
    }
    const deleteMatch = /^\/image-registry\/repositories\/([^/]+)\/tags\/([^/]+)\/delete$/.exec(path)
    if (deleteMatch) {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
      sameOriginJson(request)
      await readJson(request)
      const name = decodeURIComponent(deleteMatch[1])
      const tag = decodeURIComponent(deleteMatch[2])
      if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new ApiError(400, 'invalid_repository')
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw new ApiError(400, 'invalid_tag')
      const settings = tcrSettings(await readImageSettings(join(dirname(file), 'image-registry.json')), ctx.secrets)
      await tcrDeleteTag(settings, name, tag, signal)
      send(response, 200, { ok: true })
      return
    }
    const tagMatch = /^\/image-registry\/repositories\/([^/]+)\/tags$/.exec(path)
    if (tagMatch) {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
      const name = decodeURIComponent(tagMatch[1])
      if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new ApiError(400, 'invalid_repository')
      const rawOffset = url.searchParams.get('offset') ?? '0'
      const rawLimit = url.searchParams.get('limit') ?? '50'
      if (!/^\d+$/.test(rawOffset) || !/^\d+$/.test(rawLimit)) throw new ApiError(400, 'invalid_pagination')
      const settings = tcrSettings(await readImageSettings(join(dirname(file), 'image-registry.json')), ctx.secrets)
      send(response, 200, await tcrTags(settings, name, Number(rawOffset), Math.min(100, Math.max(1, Number(rawLimit))), signal))
      return
    }
    if (path === '/test') {
      if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed')
    } else if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
    const one = new OneDev(await readSettings(file), ctx.secrets, signal)
    if (path === '/projects' || path === '/test') {
      const raw = url.searchParams.get('offset') ?? '0'
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 1_000_000) throw new ApiError(400, 'invalid_offset')
      const offset = Number(raw)
      const projects = await one.projects(offset)
      if (path === '/test') { send(response, 200, { ok: true, projectCount: projects.length }); return }
      send(response, 200, { projects, nextOffset: projects.length === 100 ? offset + projects.length : null })
      return
    }
    if (path === '/pipelines') {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
      const rawOffset = url.searchParams.get('offset') ?? '0'
      const rawCount = url.searchParams.get('count') ?? '50'
      if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset)) || Number(rawOffset) > 1_000_000) throw new ApiError(400, 'invalid_offset')
      if (!/^\d+$/.test(rawCount) || !Number.isSafeInteger(Number(rawCount)) || Number(rawCount) < 1 || Number(rawCount) > 100) throw new ApiError(400, 'invalid_count')
      const offset = Number(rawOffset)
      const count = Number(rawCount)
      const [builds, projectNames] = await Promise.all([one.builds(offset, count), one.projectNames()])
      send(response, 200, {
        builds: builds.map(build => ({ ...build, projectName: projectNames.get(build.projectId) ?? `#${build.projectId}` })),
        nextOffset: builds.length === count ? offset + builds.length : null,
      })
      return
    }
    const pipelineMatch = /^\/pipelines\/([1-9]\d*)(?:\/(logs))?$/.exec(path)
    if (pipelineMatch) {
      if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
      const id = Number(pipelineMatch[1])
      if (!Number.isSafeInteger(id)) throw new ApiError(400, 'invalid_build_id')
      if (pipelineMatch[2] === 'logs') {
        if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed')
        send(response, 200, { text: await one.buildLogs(id) })
        return
      }
      const [build, projectNames] = await Promise.all([one.build(id), one.projectNames()])
      send(response, 200, { ...build, projectName: projectNames.get(build.projectId) ?? `#${build.projectId}` })
      return
    }
    const match = /^\/repos\/([1-9]\d*)(?:\/(resolve|tree|file|asset|raw|latest|commits))?$/.exec(path)
    if (!match) throw new ApiError(404, 'not_found')
    const id = projectId(match[1])
    if (!match[2]) { send(response, 200, await one.repository(id)); return }
    if (match[2] === 'resolve') {
      const type = url.searchParams.get('type')
      if (type !== 'branch' && type !== 'tag') throw new ApiError(400, 'invalid_revision')
      send(response, 200, { sha: await one.resolve(id, type, url.searchParams.get('name') ?? '') })
      return
    }
    const sha = commitSha(url.searchParams.get('sha') ?? '')
    const repositoryFile = repositoryPath(url.searchParams.get('path') ?? '', match[2] === 'tree' || match[2] === 'commits')
    if (match[2] === 'tree') { send(response, 200, await one.tree(id, sha, repositoryFile)); return }
    if (match[2] === 'latest') { send(response, 200, await one.latest(id, sha, repositoryFile)); return }
    if (match[2] === 'commits') { send(response, 200, await one.commits(id, sha)); return }
    const blob = await one.file(id, sha, repositoryFile)
    if (match[2] === 'file') { send(response, 200, preview(blob)); return }
    if (blob.partial || blob.size > DOWNLOAD_BYTES) throw new ApiError(413, 'download_too_large')
    const mime = match[2] === 'asset' ? imageType(blob.bytes) : 'application/octet-stream'
    if (!mime) throw new ApiError(415, 'unsupported_image')
    if (response.destroyed || signal.aborted) return
    response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox", 'content-length': blob.bytes.length,
      ...(match[2] === 'raw' ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(repositoryFile.split('/').at(-1) ?? 'download').replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}` } : {}) })
    response.end(blob.bytes)
  } catch (cause) {
    if (signal.aborted) return
    const failure = cause instanceof ApiError ? cause : new ApiError(500, 'request_failed', { cause })
    send(response, failure.status, { code: failure.code })
  }
}
function normalizeBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch (cause) { throw new ApiError(400, 'invalid_url', { cause }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ApiError(400, 'invalid_url')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}
function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(body))
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new ApiError(413, 'request_too_large')
    chunks.push(buffer)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (cause) { throw new ApiError(400, 'invalid_json', { cause }) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, 'invalid_json')
  return value as Record<string, unknown>
}
