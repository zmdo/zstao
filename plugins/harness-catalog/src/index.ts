import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'
import Schema from '@deepseek-ai/schemastery'

interface QueryableUser {
  active: string
}

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
}

export interface Config {
  skillsRoot: string
}

export const Config: Schema<Config> = Schema.object({
  skillsRoot: Schema.string().default(''),
})

const ROOT = '/console-api/harness-catalog'

export const inject = ['skills', 'tools', 'webServer', 'consoleSession']

export function apply(ctx: HostContext, config: Config): void {
  const skillsRoot = config.skillsRoot.trim() === ''
    ? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'skills')
    : config.skillsRoot.trim()
  if (!isAbsolute(skillsRoot)) throw new Error('Harness skill root must be absolute')

  ctx.effect(() => {
    const stopSkills = ctx.webServer.register({
      kind: 'exact', path: `${ROOT}/skills`,
      handler: (request, response) => listSkills(ctx, skillsRoot, request, response),
    })
    const stopTools = ctx.webServer.register({
      kind: 'exact', path: `${ROOT}/tools`,
      handler: (request, response) => listTools(ctx, request, response),
    })
    const stopImport = ctx.webServer.register({
      kind: 'exact', path: `${ROOT}/skills/import`,
      handler: (request, response) => importSkill(ctx, skillsRoot, request, response),
    })
    return () => { stopSkills(); stopTools(); stopImport() }
  })
}

const PROVIDERS: Array<{ match: RegExp; name: string; package: string }> = [
  { match: /^platform_server_/, name: '服务器管理', package: '@smp/console-server-management' },
  { match: /^platform_cos_/, name: '网络文件管理', package: '@smp/console-cos' },
  { match: /^platform_domain_/, name: '域名管理', package: '@smp/console-domain-manager' },
  { match: /^mcp__/, name: 'MCP 工具', package: '@deepseek-ai/dsh-mcp-client' },
]

function toolProvider(name: string): { name: string; package: string } {
  const found = PROVIDERS.find(item => item.match.test(name))
  return found === undefined ? { name: 'Harness 内置', package: '' } : { name: found.name, package: found.package }
}

interface CatalogSkill extends SkillSummary {}

async function listSkillCatalog(ctx: HostContext, root: string): Promise<CatalogSkill[]> {
  let skills: CatalogSkill[] = []
  try { skills = await ctx.skills.list() } catch (cause) { ctx.logger.warn(cause) }
  const seen = new Set(skills.map(skill => skill.name))
  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const file = join(root, entry.name, 'SKILL.md')
      let content: string
      try { content = await readFile(file, 'utf8') } catch { continue }
      const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(content)?.[1] ?? ''
      const name = /^name:\s*["']?([^"'\n]+)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() ?? entry.name
      if (seen.has(name) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue
      seen.add(name)
      skills.push({
        name,
        description: /^description:\s*["']?([^"\n]+)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() ?? '',
        whenToUse: /^whenToUse:\s*["']?([^"\n]+)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() ?? '',
        path: file,
        source: 'custom',
        provider: 'filesystem',
        invocation: { modelInvocable: true, userInvocable: true },
      })
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') ctx.logger.warn(cause)
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function listSkills(ctx: HostContext, root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'GET') { send(response, 405, { detail: '需要 GET' }); return }
  try {
    const skills = await listSkillCatalog(ctx, root)
    send(response, 200, {
      skills: skills.map(skill => ({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse ?? '',
        path: skill.path ?? '',
        source: skill.source,
        provider: skill.provider,
        modelInvocable: skill.invocation.modelInvocable,
        userInvocable: skill.invocation.userInvocable,
      })),
    })
  } catch (cause) {
    ctx.logger.warn(cause)
    send(response, 500, { detail: '技能列表读取失败' })
  }
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

async function importSkill(ctx: HostContext, root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!await authorized(ctx, request)) { send(response, 401, { detail: '未登录' }); return }
  if (request.method !== 'POST') { send(response, 405, { detail: '需要 POST' }); return }
  try {
    const type = String(request.headers['content-type'] ?? '')
    if (type.startsWith('application/zip') || type.startsWith('application/x-zip-compressed')) {
      await importZip(ctx, root, await readBody(request, 20 * 1024 * 1024), response)
      return
    }
    const body = await readJson(request)
    const requested = typeof body.name === 'string' ? body.name.trim() : ''
    const content = typeof body.content === 'string' ? body.content : ''
    if (content.trim() === '' || content.length > 512 * 1024) throw new Error('技能内容为空或超过 512KB')
    const frontmatterName = frontmatterNameOf(content)
    const name = requested === '' ? frontmatterName : requested
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('技能名称只能使用小写字母、数字和连字符')
    if (frontmatterName !== '' && frontmatterName !== name) throw new Error('技能名称与 SKILL.md frontmatter 不一致')
    const directory = join(root, name)
    await mkdir(root, { recursive: true })
    try {
      await mkdir(directory)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        send(response, 409, { detail: '同名技能已存在' })
        return
      }
      throw cause
    }
    await writeFile(join(directory, 'SKILL.md'), content, { encoding: 'utf8', mode: 0o644 })
    const emit = (ctx as HostContext & { emit?: (name: string) => void }).emit
    emit?.call(ctx, 'skills/change')
    send(response, 201, { name, path: join(directory, 'SKILL.md') })
  } catch (cause) {
    send(response, 400, { detail: cause instanceof Error ? cause.message : String(cause) })
  }
}

function frontmatterNameOf(content: string): string {
  return /^---[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m.exec(content)?.[1]?.trim() ?? ''
}

interface ZipEntry {
  name: string
  data: Buffer
  mode: number | undefined
}

function safeZipName(raw: string): string {
  const name = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (name === '' || name.endsWith('/')) throw new Error('zip 包含空文件名')
  const normalized = normalize(name).replace(/\\/g, '/')
  if (normalized.startsWith('../') || normalized === '..' || normalized.includes('/../') || isAbsolute(name)) throw new Error('zip 包含不安全的路径')
  return normalized
}

async function readZip(buffer: Buffer): Promise<ZipEntry[]> {
  return await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error: Error | null, zip: any) => {
      if (error !== null || zip === undefined) { reject(error ?? new Error('zip 读取失败')); return }
      const entries: ZipEntry[] = []
      let total = 0
      const fail = (cause: unknown) => { zip.close(); reject(cause) }
      zip.on('error', fail)
      zip.on('end', () => resolve(entries))
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
            stream.on('end', () => {
              entries.push({ name, data: Buffer.concat(chunks), mode })
              zip.readEntry()
            })
          })
        } catch (cause) { fail(cause) }
      })
      zip.readEntry()
    })
  })
}

async function importZip(ctx: HostContext, root: string, buffer: Buffer, response: ServerResponse): Promise<void> {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('不是有效的 zip')
  const entries = await readZip(buffer)
  if (entries.length === 0) throw new Error('zip 为空')
  const candidates = entries.filter(entry => entry.name.split('/').pop() === 'SKILL.md')
  if (candidates.length === 0) throw new Error('zip 中没有 SKILL.md')
  const rootCandidate = candidates.find(entry => entry.name === 'SKILL.md')
  const candidate = rootCandidate ?? candidates.sort((a, b) => a.name.length - b.name.length)[0]
  if (candidate === undefined) throw new Error('zip 中没有 SKILL.md')
  const base = candidate.name === 'SKILL.md' ? '' : candidate.name.slice(0, candidate.name.length - 'SKILL.md'.length)
  if (base !== '' && !base.endsWith('/')) throw new Error('zip 目录结构无效')
  const content = candidate.data.toString('utf8')
  const name = frontmatterNameOf(content)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('技能名称只能使用小写字母、数字和连字符')
  const directory = join(root, name)
  const staging = join(root, `.import-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  try {
    await mkdir(staging, { recursive: true })
    for (const entry of entries) {
      if (entry === candidate) continue
      if (base !== '' && !entry.name.startsWith(base)) throw new Error('zip 包含 SKILL.md 目录之外的文件')
      const relative = base === '' ? entry.name : entry.name.slice(base.length)
      if (relative === '') continue
      const destination = join(staging, relative)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, entry.data)
      const executable = entry.mode !== undefined && (entry.mode & 0o111) !== 0
      await chmod(destination, executable ? 0o755 : 0o644)
    }
    await writeFile(join(staging, 'SKILL.md'), content)
    await chmod(join(staging, 'SKILL.md'), 0o644)
    try {
      await mkdir(directory)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
        send(response, 409, { detail: '同名技能已存在' })
        return
      }
      throw cause
    }
    await rm(directory, { recursive: true, force: true })
    await rename(staging, directory)
    const emit = (ctx as HostContext & { emit?: (name: string) => void }).emit
    emit?.call(ctx, 'skills/change')
    send(response, 201, { name, path: join(directory, 'SKILL.md'), files: entries.length })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
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
