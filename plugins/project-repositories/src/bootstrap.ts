import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError, type OneDev } from './onedev.ts'
import type { Project } from './shared.ts'

export interface BootstrapSettings {
  gitSshBaseUrl: string
  projectSpace: string
  buildExecutor: string
  nodeImage: string
}
export const BOOTSTRAP_DEFAULTS: BootstrapSettings = Object.freeze({
  gitSshBaseUrl: '', projectSpace: 'apps', buildExecutor: 'ces-build-test', nodeImage: 'node:24-alpine',
})

export function projectPath(value: string): string {
  if (value.length > 255 || !/^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63})*$/.test(value)) throw new ApiError(400, 'invalid_project_name')
  return value
}
export function bootstrapSettings(value: Record<string, unknown>): BootstrapSettings {
  const read = (key: keyof BootstrapSettings) => {
    if (value[key] === undefined) return BOOTSTRAP_DEFAULTS[key]
    if (typeof value[key] !== 'string') throw new ApiError(400, 'invalid_delivery_settings')
    return value[key].trim()
  }
  const result = { gitSshBaseUrl: read('gitSshBaseUrl'), projectSpace: projectPath(read('projectSpace')), buildExecutor: read('buildExecutor'), nodeImage: read('nodeImage') }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(result.buildExecutor)) throw new ApiError(400, 'invalid_build_executor')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/.test(result.nodeImage)) throw new ApiError(400, 'invalid_node_image')
  if (result.gitSshBaseUrl) {
    let url: URL
    try { url = new URL(result.gitSshBaseUrl) } catch (cause) { throw new ApiError(400, 'invalid_git_ssh_url', { cause }) }
    if (url.protocol !== 'ssh:' || !url.hostname || !url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new ApiError(400, 'invalid_git_ssh_url')
    result.gitSshBaseUrl = url.href.replace(/\/$/, '')
  }
  return result
}
export function managedProject(path: string, settings: BootstrapSettings): boolean {
  return path.startsWith(settings.projectSpace + '/')
}
export async function resolveProject(one: OneDev, name: string, settings: BootstrapSettings): Promise<Project | null> {
  projectPath(name)
  const exact = await one.projectByName(name)
  return exact ?? (name.includes('/') ? null : one.projectByName(`${settings.projectSpace}/${name}`))
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
async function readable(path: string): Promise<boolean> {
  try { await access(path); return true } catch (cause) {
    if (cause instanceof Error && 'code' in cause && ['ENOENT', 'EACCES'].includes(String(cause.code))) return false
    throw cause
  }
}
export async function projectContext(one: OneDev, project: Project, settings: BootstrapSettings, home: string, image: { registry: string; namespace: string }) {
  const urls = await one.cloneUrls(project.id, project.path)
  const privateKeyPath = join(home, 'keys', 'cesai')
  const knownHostsPath = join(home, 'keys', 'known_hosts')
  const [keyPresent, hostsPresent] = await Promise.all([readable(privateKeyPath), readable(knownHostsPath)])
  const managed = managedProject(project.path, settings)
  return {
    git: { cloneUrl: urls.http, sshCloneUrl: urls.ssh, username: 'cesai', name: 'CES AI', email: 'cesai@dianzinao.cn', privateKeyPath, knownHostsPath,
      sshCommand: `ssh -i ${shellQuote(privateKeyPath)} -o IdentitiesOnly=yes -o UserKnownHostsFile=${shellQuote(knownHostsPath)} -o StrictHostKeyChecking=yes`,
      configured: Boolean(urls.ssh && keyPresent && hostsPresent), missing: [...(!urls.ssh ? ['git_ssh_url'] : []), ...(!keyPresent ? ['git_private_key'] : []), ...(!hostsPresent ? ['git_known_hosts'] : [])] },
    delivery: { managed, projectSpace: settings.projectSpace, job: 'build', executor: settings.buildExecutor,
      dockerConfig: '/srv/ces-build/docker-config', nodeImage: settings.nodeImage,
      imageRepository: managed && image.namespace ? `${image.registry}/${image.namespace}/ces-project-${project.id}` : null,
      application: `project-${project.id}`, directory: `/srv/apps/project-${project.id}`, preparation: managed ? 'call_prepare_delivery' : 'use_existing_project_configuration' },
  }
}

export async function createManagedProject(one: OneDev, name: string, description: string, settings: BootstrapSettings, authorize: () => Promise<void>) {
  projectPath(name)
  const path = name.includes('/') ? name : `${settings.projectSpace}/${name}`
  let project = await one.projectByName(path)
  // Legacy root projects remain usable without changing their access.
  if (!project && !name.includes('/')) project = await one.projectByName(name)
  if (project && !managedProject(project.path, settings)) return { created: false, project, managed: false, repositoryReady: project.codeManagement,
    access: { ready: null, changed: false, reason: 'existing_unmanaged_project' } }
  if (!managedProject(path, settings)) throw new ApiError(403, 'project_outside_managed_space')
  await authorize()
  const result = project ? { created: false, project } : await one.createProject(path, description)
  try {
    const userId = await one.findUser('cesai')
    if (userId === null) throw new ApiError(409, 'ai_user_missing')
    const changed = await one.ensureCodeWriter(result.project.id, userId)
    return { ...result, managed: true, repositoryReady: result.project.codeManagement, access: { ready: true, changed } }
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause
    return { ...result, managed: true, repositoryReady: result.project.codeManagement,
      access: { ready: false, changed: false, error: cause.code, retry: 'Call create_project with the same project path to finish authorization.' } }
  }
}

export async function buildEnvironment(one: OneDev, settings: BootstrapSettings) {
  const raw = await one.request('settings/job-executors')
  if (!Array.isArray(raw)) throw new ApiError(502, 'invalid_upstream')
  const executor = raw.find(item => item && item.name === settings.buildExecutor)
  if (!executor || executor.enabled !== true) throw new ApiError(409, 'build_executor_missing_or_disabled')
  if (executor['@type'] !== 'RemoteShellExecutor') throw new ApiError(409, 'remote_shell_executor_required')
  for (let offset = 0; offset < 10_000; offset += 100) {
    const agents = await one.request('agents', new URLSearchParams({ query: typeof executor.agentQuery === 'string' ? executor.agentQuery : '', offset: String(offset), count: '100' }))
    if (!Array.isArray(agents)) throw new ApiError(502, 'invalid_upstream')
    const online = agents.filter(agent => agent?.online === true && agent?.paused !== true)
    if (online.length) return { executor: settings.buildExecutor, jobMatch: typeof executor.jobMatch === 'string' ? executor.jobMatch : '',
      agents: online.map(agent => ({ id: agent.id, name: agent.name })), jobMatchValidation: 'OneDev checks applicability when submitting the build.' }
    if (agents.length < 100) throw new ApiError(409, 'build_agent_offline')
  }
  throw new ApiError(409, 'build_agent_lookup_incomplete')
}
