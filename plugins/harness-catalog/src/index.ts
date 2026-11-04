import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'
import Schema from '@deepseek-ai/schemastery'

interface SkillSummary {
  name: string
  description: string
  whenToUse?: string
  path?: string
  source: string
  provider: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
}

interface ToolSchema {
  name: string
  description: string
  parameters?: unknown
}

interface SkillService {
  list(options?: { cwd?: string }): Promise<SkillSummary[]>
}

interface ToolService {
  schemas(): ToolSchema[]
}

interface HostContext {
  skills: SkillService
  tools: ToolService
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler(request: IncomingMessage, response: ServerResponse): Promise<void>
    }): () => void
  }
  consoleSession: { read(cookie: string): Promise<unknown> }
  logger: { warn(error: unknown): void }
  effect(run: () => (() => void)): void
  emit?: (name: string) => void
}

export interface Config {
  skillsRoot: string
}

export const Config: Schema<Config> = Schema.object({
  skillsRoot: Schema.string().default(''),
})

const ROOT = '/console-api/harness-catalog'
const PROVIDERS: Array<{ match: RegExp; name: string; package: string }> = [
  { match: /^platform_server_/, name: '服务器管理', package: '@smp/console-server-management' },
  { match: /^platform_cos_/, name: '网络文件管理', package: '@smp/console-cos' },
  { match: /^platform_domain_/, name: '域名管理', package: '@smp/console-domain-manager' },
  { match: /^mcp__/, name: 'MCP 工具', package: '@deepseek-ai/dsh-mcp-client' },
]

export const inject = ['skills', 'tools', 'webServer', 'consoleSession']

export function apply(ctx: HostContext, config: Config): void {
  const skillsRoot = config.skillsRoot.trim() === ''
    ? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'skills')
    : config.skillsRoot.trim()
  if (!isAbsolute(skillsRoot)) throw new Error('Harness skill root must be absolute')
  const disabledRoot = join(dirname(skillsRoot), 'skills-disabled')

  ctx.effect(() => {
    const stops = [
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/skills`, handler: (request, response) => listSkills(ctx, skillsRoot, disabledRoot, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/tools`, handler: (request, response) => listTools(ctx, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/skills/inspect`, handler: (request, response) => inspectSkill(ctx, skillsRoot, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/skills/import`, handler: (request, response) => importSkill(ctx, skillsRoot, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/skills/state`, handler: (request, response) => changeState(ctx, skillsRoot, disabledRoot, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/skills/remove`, handler: (request, response) => removeSkill(ctx, skillsRoot, disabledRoot, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/skills/files`, handler: (request, response) => listFiles(ctx, skillsRoot, disabledRoot, request, response) }),
      ctx.webServer.register({ kind: 'exact', path: `${ROOT}/skills/file`, handler: (request, response) => readFileRoute(ctx, skillsRoot, disabledRoot, request, response) }),
    ]
    return () => { for (const stop of stops) stop() }
  })
}

function toolProvider(name: string): { name: string; package: string } {
  const found = PROVIDERS.find(item => item.match.test(name))
  return found === undefined ? { name: 'Harness 内置', package: '' } : { name: found.name, package: found.package }
}

interface CatalogSkill extends SkillSummary {
  enabled: boolean
  editable: boolean
}

async function listSkills(ctx: HostContext, root: string, disabledRoot: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { detail: '需要 GET' }); return }
  try {
    send(response, 200, { skills: await listSkillCatalog(ctx, root, disabledRoot) })
  } catch (cause) {
    ctx.logger.warn(cause)
    send(response, 500, { detail: '技能列表读取失败' })
  }
}

async function listSkillCatalog(ctx: HostContext, root: string, disabledRoot: string): Promise<CatalogSkill[]> {
  let skills: CatalogSkill[] = []
  try {
    const discovered = await ctx.skills.list()
    for (const skill of discovered) {
      // The registry may retain a just-disabled/deleted custom skill until its
      // filesystem watcher settles. The directory is authoritative for our own
      // managed root, so do not keep serving an entry whose file is gone.
      if (skill.path !== undefined && isUnder(skill.path, root) && !await exists(skill.path)) continue
      skills.push({
        ...skill,
        enabled: true,
        editable: skill.path !== undefined && isUnder(skill.path, root),
      })
    }
  } catch (cause) { ctx.logger.warn(cause) }
  const seen = new Set(skills.map(skill => skill.name))
  await appendDirectory(root, true, seen, skills)
  await appendDirectory(disabledRoot, false, seen, skills)
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function appendDirectory(root: string, enabled: boolean, seen: Set<string>, out: CatalogSkill[]): Promise<void> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory() || seen.has(entry.name)) continue
    const file = join(root, entry.name, 'SKILL.md')
    let content: string
    try { content = await readFile(file, 'utf8') } catch { continue }
    const frontmatter = frontmatterOf(content)
    const name = frontmatter.name === '' ? entry.name : frontmatter.name
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || seen.has(name)) continue
    seen.add(name)
    out.push({
      name,
      description: frontmatter.description,
      whenToUse: frontmatter.whenToUse,
      path: file,
      source: 'custom',
      provider: 'filesystem',
      invocation: { modelInvocable: true, userInvocable: true },
      enabled,
      editable: true,
    })
  }
}

function frontmatterOf(content: string): { name: string; description: string; whenToUse: string } {
  const block = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(content)?.[1] ?? ''
  const value = (key: string) => new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm').exec(block)?.[1]?.trim() ?? ''
  return { name: value('name'), description: value('description'), whenToUse: value('whenToUse') || value('when-to-use') }
}

async function listTools(ctx: HostContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { detail: '需要 GET' }); return }
  try {
    send(response, 200, {
      tools: ctx.tools.schemas().map(tool => {
        const provider = toolProvider(tool.name)
        return { name: tool.name, description: tool.description, provider: provider.name, providerPackage: provider.package, parameters: tool.parameters ?? null }
      }),
    })
  } catch (cause) {
    ctx.logger.warn(cause)
    send(response, 500, { detail: '工具列表读取失败' })
  }
}

interface ZipEntry { name: string; data: Buffer; mode: number | undefined }
interface SkillPackage { name: string; description: string; whenToUse: string; content: string; entries: ZipEntry[]; base: string }

async function inspectSkill(ctx: HostContext, root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'POST') { send(response, 405, { detail: '需要 POST' }); return }
  try {
    const pkg = await readPackage(request)
    if (await exists(join(root, pkg.name))) {
      send(response, 200, { valid: false, error: '同名技能已存在' })
      return
    }
    send(response, 200, {
      valid: true,
      name: pkg.name,
      description: pkg.description,
      whenToUse: pkg.whenToUse,
      path: join(root, pkg.name),
      files: pkg.entries.filter(entry => entry.name !== `${pkg.base}SKILL.md`).map(entry => ({
        path: pkg.base === '' ? entry.name : entry.name.slice(pkg.base.length),
        size: entry.data.length,
        executable: entry.mode !== undefined && (entry.mode & 0o111) !== 0,
      })),
    })
  } catch (cause) {
    send(response, 200, { valid: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

async function importSkill(ctx: HostContext, root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'POST') { send(response, 405, { detail: '需要 POST' }); return }
  try {
    const pkg = await readPackage(request)
    const directory = join(root, pkg.name)
    await mkdir(root, { recursive: true })
    if (await exists(directory)) { send(response, 409, { detail: '同名技能已存在' }); return }
    const staging = join(root, `.import-${randomUUID()}`)
    try {
      await mkdir(staging, { recursive: true })
      for (const entry of pkg.entries) {
        if (entry.name === `${pkg.base}SKILL.md`) continue
        if (pkg.base !== '' && !entry.name.startsWith(pkg.base)) throw new Error('zip 包含 SKILL.md 目录之外的文件')
        const rel = pkg.base === '' ? entry.name : entry.name.slice(pkg.base.length)
        if (rel === '') continue
        const destination = join(staging, rel)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, entry.data)
        await chmod(destination, entry.mode !== undefined && (entry.mode & 0o111) !== 0 ? 0o755 : 0o644)
      }
      await writeFile(join(staging, 'SKILL.md'), pkg.content, { encoding: 'utf8', mode: 0o644 })
      await chmod(join(staging, 'SKILL.md'), 0o644)
      await rename(staging, directory)
      ctx.emit?.('skills/change')
      send(response, 201, { name: pkg.name, path: join(directory, 'SKILL.md'), files: pkg.entries.length })
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  } catch (cause) {
    send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

async function changeState(ctx: HostContext, root: string, disabledRoot: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'POST') { send(response, 405, { detail: '需要 POST' }); return }
  try {
    const body = await readJson(request)
    const name = nameField(body)
    const enabled = body.enabled === true
    const source = enabled ? disabledRoot : root
    const target = enabled ? root : disabledRoot
    const from = join(source, name)
    const to = join(target, name)
    if (!await exists(from)) throw new Error('技能不存在')
    if (await exists(to)) throw new Error('目标位置已有同名技能')
    await mkdir(target, { recursive: true })
    await rename(from, to)
    ctx.emit?.('skills/change')
    send(response, 200, { ok: true, enabled })
  } catch (cause) { send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) }) }
}

async function removeSkill(ctx: HostContext, root: string, disabledRoot: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'DELETE') { send(response, 405, { detail: '需要 DELETE' }); return }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const name = nameField({ name: url.searchParams.get('name') ?? '' })
    let removed = false
    for (const base of [root, disabledRoot]) {
      const directory = join(base, name)
      if (await exists(directory)) { await rm(directory, { recursive: true, force: true }); removed = true }
    }
    if (!removed) throw new Error('技能不存在')
    ctx.emit?.('skills/change')
    send(response, 200, { ok: true })
  } catch (cause) { send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) }) }
}

async function listFiles(ctx: HostContext, root: string, disabledRoot: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { detail: '需要 GET' }); return }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const base = await skillDirectory(root, disabledRoot, url.searchParams.get('name') ?? '')
    const target = safeTarget(base, url.searchParams.get('path') ?? '')
    const info = await stat(target)
    if (!info.isDirectory()) throw new Error('不是目录')
    const entries = await readdir(target, { withFileTypes: true })
    const items = []
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const full = join(target, entry.name)
      const entryInfo = await stat(full)
      items.push({ name: entry.name, path: relative(base, full).split(sep).join('/'), type: entryInfo.isDirectory() ? 'directory' : 'file', size: entryInfo.isFile() ? entryInfo.size : null })
    }
    items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    send(response, 200, { path: relative(base, target).split(sep).join('/'), entries: items })
  } catch (cause) { send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) }) }
}

async function readFileRoute(ctx: HostContext, root: string, disabledRoot: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { detail: '需要 GET' }); return }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const base = await skillDirectory(root, disabledRoot, url.searchParams.get('name') ?? '')
    const target = safeTarget(base, url.searchParams.get('path') ?? '')
    const info = await stat(target)
    if (!info.isFile()) throw new Error('不是文件')
    if (info.size > 200 * 1024) throw new Error('文件超过 200KB，暂不预览')
    const data = await readFile(target)
    const binary = data.includes(0)
    send(response, 200, {
      path: relative(base, target).split(sep).join('/'),
      binary,
      size: info.size,
      content: binary ? '' : data.toString('utf8'),
    })
  } catch (cause) { send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) }) }
}

function nameField(body: Record<string, unknown>): string {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('技能名称不合法')
  return name
}

async function skillDirectory(root: string, disabledRoot: string, name: string): Promise<string> {
  const valid = nameField({ name })
  for (const base of [root, disabledRoot]) {
    const directory = join(base, valid)
    if (await exists(directory)) return directory
  }
  throw new Error('技能不存在')
}

function safeTarget(base: string, path: string): string {
  const target = resolve(base, path)
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('路径越界')
  return target
}

function isUnder(path: string, root: string): boolean {
  const parent = `${resolve(root)}${sep}`
  return resolve(path).startsWith(parent)
}

async function readPackage(request: IncomingMessage): Promise<SkillPackage> {
  const type = String(request.headers['content-type'] ?? '')
  if (type.startsWith('application/zip') || type.startsWith('application/x-zip-compressed')) {
    const entries = await readZip(await readBody(request, 20 * 1024 * 1024))
    return packageFromZip(entries)
  }
  const body = await readJson(request)
  const content = typeof body.content === 'string' ? body.content : ''
  if (content.trim() === '' || content.length > 512 * 1024) throw new Error('技能内容为空或超过 512KB')
  const fm = frontmatterOf(content)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.name)) throw new Error('技能名称只能使用小写字母、数字和连字符')
  return { name: fm.name, description: fm.description, whenToUse: fm.whenToUse, content, entries: [], base: '' }
}

function packageFromZip(entries: ZipEntry[]): SkillPackage {
  if (entries.length === 0) throw new Error('zip 为空')
  const candidates = entries.filter(entry => entry.name.split('/').pop() === 'SKILL.md')
  if (candidates.length === 0) throw new Error('zip 中没有 SKILL.md')
  const rootCandidate = candidates.find(entry => entry.name === 'SKILL.md')
  const candidate = rootCandidate ?? candidates.sort((a, b) => a.name.length - b.name.length)[0]
  if (candidate === undefined) throw new Error('zip 中没有 SKILL.md')
  const base = candidate.name === 'SKILL.md' ? '' : candidate.name.slice(0, candidate.name.length - 'SKILL.md'.length)
  if (base !== '' && !base.endsWith('/')) throw new Error('zip 目录结构无效')
  const content = candidate.data.toString('utf8')
  const fm = frontmatterOf(content)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.name)) throw new Error('SKILL.md frontmatter 缺少合法 name')
  for (const entry of entries) {
    if (base !== '' && !entry.name.startsWith(base) && entry !== candidate) throw new Error('zip 包含 SKILL.md 目录之外的文件')
  }
  return { name: fm.name, description: fm.description, whenToUse: fm.whenToUse, content, entries, base }
}

async function readZip(buffer: Buffer): Promise<ZipEntry[]> {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('不是有效的 zip')
  return await new Promise((resolvePromise, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error: Error | null, zip: any) => {
      if (error !== null || zip === undefined) { reject(error ?? new Error('zip 读取失败')); return }
      const entries: ZipEntry[] = []
      let total = 0
      const fail = (cause: unknown) => { zip.close(); reject(cause) }
      zip.on('error', fail)
      zip.on('end', () => resolvePromise(entries))
      zip.on('entry', (entry: any) => {
        try {
          if (entry.isEncrypted === true) throw new Error('不支持加密 zip')
          const rawName = String(entry.fileName).replace(/\\/g, '/')
          if (rawName.startsWith('__MACOSX/') || rawName === '.DS_Store' || rawName.endsWith('/.DS_Store')) { zip.readEntry(); return }
          if (rawName.endsWith('/')) { zip.readEntry(); return }
          if (entry.uncompressedSize > 25 * 1024 * 1024) throw new Error('zip 内单个文件过大')
          total += entry.uncompressedSize
          if (total > 50 * 1024 * 1024) throw new Error('zip 解压后总大小超过 50MB')
          if (entries.length >= 500) throw new Error('zip 文件数量超过 500')
          const name = safeZipName(rawName)
          const madeBy = (entry.versionMadeBy >>> 8) & 0xff
          const mode = madeBy === 3 ? ((entry.externalFileAttributes >>> 16) & 0o7777) : undefined
          if (mode !== undefined && (mode & 0o170000) === 0o120000) throw new Error('zip 不允许符号链接')
          zip.openReadStream(entry, (streamError: Error | null, stream: any) => {
            if (streamError !== null || stream === undefined) { fail(streamError ?? new Error('zip 读取失败')); return }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
            stream.on('error', fail)
            stream.on('end', () => { entries.push({ name, data: Buffer.concat(chunks), mode }); zip.readEntry() })
          })
        } catch (cause) { fail(cause) }
      })
      zip.readEntry()
    })
  })
}

function safeZipName(raw: string): string {
  const name = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (name === '' || name.endsWith('/')) throw new Error('zip 包含空文件名')
  const parts = name.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw new Error('zip 包含不安全的路径')
  return parts.join('/')
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

async function authorized(ctx: HostContext, request: IncomingMessage): Promise<boolean> {
  const cookie = request.headers.cookie
  return await ctx.consoleSession.read(Array.isArray(cookie) ? cookie.join('; ') : cookie ?? '') !== undefined
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > max) throw new Error('请求过大')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse((await readBody(request, 512 * 1024)).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('请求必须是 JSON 对象')
  return value as Record<string, unknown>
}
