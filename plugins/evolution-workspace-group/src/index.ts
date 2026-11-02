import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'

/*
 * The group and the git capability live in the same plugin so the settings page,
 * the authorization check and the credential injection have one owner.
 */
const GROUP_ID = 'evolution-dev'
const GROUP_DIRECTORY = '.smp/evolution-dev'
const API = '/console-api/evolution-dev/git'
const DEFAULT_WORKDIR = '/root/.smp/evolution-dev/default-workspace'
const ROLES = new Set(['onedev', 'backup'])
const AUTH_TYPES = new Set(['https_token', 'https_password', 'ssh_key', 'ssh_agent'])
const TEXT_OUTPUT = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }

interface Remote {
  role: string
  name: string
  url: string
  username: string
  authType: string
  secretCiphertext: string | null
  passphraseCiphertext: string | null
  knownHosts: string | null
  pushMode: string
  enabled: boolean
}

interface Settings {
  enabled: boolean
  workdir: string
  remotes: Remote[]
}

export const inject = ['database', 'secrets', 'consoleSession', 'webServer', 'workspaceGroups', 'agents', 'systemPrompt']

export async function apply(ctx: any): Promise<void> {
  const db = ctx.database.pool
  const secrets = ctx.secrets
  await bootstrap(db)

  await ctx.workspaceGroups.register({
    id: GROUP_ID,
    label: '演进开发',
    labelI18n: { zh: '演进开发', en: 'Evolution development' },
    directory: GROUP_DIRECTORY,
    order: 30,
  })

  const service = { db, secrets, session: ctx.consoleSession }
  await installRoutes(ctx, service)
  await installGitTool(ctx, service)
}

async function bootstrap(db: any): Promise<void> {
  await db.query(`create table if not exists evolution_git_settings (
    id integer primary key check (id = 1),
    enabled boolean not null default true,
    workdir text not null
  )`)
  await db.query(`insert into evolution_git_settings (id, enabled, workdir)
    values (1, true, $1) on conflict (id) do nothing`, [DEFAULT_WORKDIR])
  await db.query(`create table if not exists evolution_git_remote (
    role text primary key,
    name text not null,
    url text not null,
    username text not null default '',
    auth_type text not null,
    secret_ciphertext text,
    passphrase_ciphertext text,
    known_hosts text,
    push_mode text not null default 'mirror',
    enabled boolean not null default true,
    updated_at timestamptz not null default now()
  )`)
  await db.query(`create table if not exists evolution_git_audit (
    id bigserial primary key,
    session_id text,
    group_id text,
    args jsonb not null,
    exit_code integer,
    output_bytes integer,
    created_at timestamptz not null default now()
  )`)
}

async function loadSettings(db: any): Promise<Settings> {
  const setting = (await db.query(`select enabled, workdir from evolution_git_settings where id = 1`)).rows[0]
  const rows = (await db.query(`select role, name, url, username, auth_type, secret_ciphertext,
    passphrase_ciphertext, known_hosts, push_mode, enabled from evolution_git_remote order by role`)).rows
  return {
    enabled: setting?.enabled ?? true,
    workdir: setting?.workdir ?? DEFAULT_WORKDIR,
    remotes: rows.map((row: any) => ({
      role: row.role,
      name: row.name,
      url: row.url,
      username: row.username,
      authType: row.auth_type,
      secretCiphertext: row.secret_ciphertext,
      passphraseCiphertext: row.passphrase_ciphertext,
      knownHosts: row.known_hosts,
      pushMode: row.push_mode,
      enabled: row.enabled,
    })),
  }
}

async function installRoutes(ctx: any, service: { db: any; secrets: any; session: any }): Promise<void> {
  const dispose = ctx.webServer.register({ kind: 'prefix', path: API, handler: (request: any, response: any) => handle(service, request, response) })
  ctx.effect(function* () { yield () => dispose() })
}

async function handle(service: { db: any; secrets: any; session: any }, request: any, response: any): Promise<void> {
  const cookie = Array.isArray(request.headers.cookie) ? request.headers.cookie.join('; ') : request.headers.cookie ?? ''
  if (await service.session.read(cookie) === undefined) {
    send(response, 401, { error: 'auth/required' })
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname.slice(API.length) || '/config'
    if (path === '/config' && request.method === 'GET') {
      send(response, 200, publicSettings(await loadSettings(service.db)))
      return
    }
    if (path === '/config' && (request.method === 'POST' || request.method === 'PUT')) {
      const body = await readJson(request)
      await saveConfig(service, body)
      send(response, 200, publicSettings(await loadSettings(service.db)))
      return
    }
    if (path === '/test' && request.method === 'POST') {
      const body = await readJson(request)
      const role = String(body.role ?? 'backup')
      const settings = await loadSettings(service.db)
      const remote = settings.remotes.find((item: Remote) => item.role === role)
      if (!remote) throw new Error('该 remote 尚未配置')
      const result = await runGit(service, settings, ['ls-remote', remote.url], undefined, { test: true })
      const secret = remote.secretCiphertext ? service.secrets.decrypt(remote.secretCiphertext) : ''
      send(response, 200, { ok: result.exitCode === 0, code: result.exitCode, output: sanitize(result.stdout || result.stderr, remote, secret) })
      return
    }
    send(response, 404, { error: 'not_found' })
  } catch (cause) {
    send(response, 400, { error: cause instanceof Error ? cause.message : String(cause) })
  }
}

function publicSettings(settings: Settings): unknown {
  return {
    enabled: settings.enabled,
    workdir: settings.workdir,
    remotes: settings.remotes.map((remote: Remote) => ({
      role: remote.role,
      name: remote.name,
      url: remote.url,
      username: remote.username,
      authType: remote.authType,
      pushMode: remote.pushMode,
      enabled: remote.enabled,
      hasSecret: remote.secretCiphertext !== null,
    })),
  }
}

async function saveConfig(service: { db: any; secrets: any }, body: any): Promise<void> {
  const enabled = body.enabled !== false
  const workdir = String(body.workdir || DEFAULT_WORKDIR).trim()
  if (!workdir.startsWith('/')) throw new Error('workdir 必须是绝对路径')
  await service.db.query(`update evolution_git_settings set enabled = $1, workdir = $2 where id = 1`, [enabled, workdir])
  const remotes = Array.isArray(body.remotes) ? body.remotes : []
  for (const input of remotes) {
    const role = String(input.role ?? '')
    if (!ROLES.has(role)) throw new Error('未知 remote')
    const authType = String(input.authType ?? 'https_token')
    if (!AUTH_TYPES.has(authType)) throw new Error('未知认证方式')
    const url = String(input.url ?? '').trim()
    if (!/^(https?|ssh|git):\/\//.test(url) && !/^[^@\s]+@[^:\s]+:/.test(url)) throw new Error('remote 地址必须是 http(s)://、ssh://、git:// 或 git@host:path')
    const username = String(input.username ?? '').trim()
    const name = String(input.name ?? (role === 'onedev' ? 'OneDev' : '备份')).trim() || role
    const pushMode = ['mirror', 'all_tags', 'branches'].includes(String(input.pushMode)) ? String(input.pushMode) : 'mirror'
    const existing = (await service.db.query(`select secret_ciphertext, passphrase_ciphertext from evolution_git_remote where role = $1`, [role])).rows[0]
    const secret = typeof input.secret === 'string' && input.secret !== '' ? service.secrets.encrypt(input.secret) : (existing?.secret_ciphertext ?? null)
    const passphrase = typeof input.passphrase === 'string' && input.passphrase !== '' ? service.secrets.encrypt(input.passphrase) : (existing?.passphrase_ciphertext ?? null)
    await service.db.query(`insert into evolution_git_remote
      (role, name, url, username, auth_type, secret_ciphertext, passphrase_ciphertext, known_hosts, push_mode, enabled)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (role) do update set name=excluded.name, url=excluded.url, username=excluded.username,
        auth_type=excluded.auth_type, secret_ciphertext=excluded.secret_ciphertext,
        passphrase_ciphertext=excluded.passphrase_ciphertext, known_hosts=excluded.known_hosts,
        push_mode=excluded.push_mode, enabled=excluded.enabled, updated_at=now()`,
      [role, name, url, username, authType, secret, passphrase, input.knownHosts ?? null, pushMode, input.enabled !== false])
  }
}

async function installGitTool(ctx: any, service: { db: any; secrets: any }): Promise<void> {
  const groups = ctx.workspaceGroups
  const registrations = new Map<any, () => void>()
  const disposed = new WeakSet<object>()
  let closed = false
  const allowed = async (agent: any) => agent !== undefined && await groups.groupForSession(agent.id) === GROUP_ID
  const check = async (agent: any) => {
    if (!await allowed(agent)) throw new Error('仅“演进开发”工作区组可以使用 git 工具')
  }
  const release = (agent: any) => {
    registrations.get(agent)?.()
    registrations.delete(agent)
  }
  const refresh = async (agent: any) => {
    if (closed || disposed.has(agent)) return false
    const enabled = await allowed(agent)
    if (enabled === registrations.has(agent)) return false
    if (enabled) {
      const dispose = agent.ctx.tools.register(defineTool({
        name: 'git',
        description: 'Run git in the evolution development workspace. Credentials are injected by the platform; never print or write secrets. Use normal git commands, including remote and push.',
        parameters: {
          args: { type: 'array', items: { type: 'string' }, required: true, description: 'Git argv without the leading git, for example ["status","-sb"].' },
        },
        output: TEXT_OUTPUT,
        timeoutMs: 300000,
        execute: async (args: any, exec: any) => {
          await check(exec.agent)
          const argv = Array.isArray(args.args) ? args.args.map(String) : []
          if (argv.length === 0) throw new Error('git 参数不能为空')
          const settings = await loadSettings(service.db)
          if (!settings.enabled) throw new Error('演进开发 Git 工具已关闭')
          const result = await runGit(service, settings, argv, exec.agent)
          await audit(service, exec.agent, argv, result)
          return JSON.stringify(result)
        },
      }))
      registrations.set(agent, dispose)
    } else release(agent)
    return true
  }
  ctx.effect(function* () {
    yield () => {
      closed = true
      for (const agent of [...registrations.keys()]) release(agent)
    }
  })
  ctx.on('agent/created', async ({ agent }: any) => { await refresh(agent) })
  ctx.on('agent/disposed', ({ agent }: any) => { disposed.add(agent); release(agent) })
  ctx.on('system-prompt/assemble', async (_assembly: any, context: any, next: any) => {
    const changed = context.agent === undefined ? false : await refresh(context.agent)
    const result = await next()
    return changed && !closed ? ctx.systemPrompt.assemble(context) : result
  })
  await Promise.all((ctx.agents?.list?.() ?? []).map((agent: any) => refresh(agent)))
}

async function audit(service: { db: any }, agent: any, argv: string[], result: any): Promise<void> {
  try {
    await service.db.query(`insert into evolution_git_audit (session_id, group_id, args, exit_code, output_bytes)
      values ($1,$2,$3,$4,$5)`, [agent?.id ?? null, GROUP_ID, JSON.stringify(argv), result.exitCode ?? null, (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0)])
  } catch { /* audit must not block git */ }
}

function sanitize(value: string, remote: Remote, secret = ''): string {
  let text = value.split('\n').filter(line => !/^\s*(Username|Password) for /.test(line)).join('\n')
  text = text.replaceAll(remote.url, remote.url.replace(/\/\/[^/@]*@/, '//'))
  if (secret) text = text.split(secret).join('***')
  return text.slice(-12000)
}

async function runGit(service: { db: any; secrets: any }, settings: Settings, argv: string[], agent?: any, options: { test?: boolean } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cwd = settings.workdir
  await mkdir(cwd, { recursive: true }).catch(() => undefined)
  const secretValues: string[] = []
  for (const remote of settings.remotes) {
    if (!remote.secretCiphertext) continue
    try { secretValues.push(service.secrets.decrypt(remote.secretCiphertext)) } catch { /* ignore undecryptable values */ }
  }
  const redact = (value: string): string => secretValues.reduce((text, secret) => secret ? text.split(secret).join('***') : text, value)
  const temp = await mkdtemp(join(tmpdir(), 'evolution-dev-git-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  }
  try {
    const https = settings.remotes.filter((remote: Remote) => remote.enabled && ['https_token', 'https_password'].includes(remote.authType))
    if (https.length > 0) {
      const map: Record<string, { username: string; password: string }> = {}
      for (const remote of https) {
        if (!remote.secretCiphertext) continue
        const host = hostOf(remote.url)
        if (host) map[host] = { username: remote.username, password: service.secrets.decrypt(remote.secretCiphertext) }
      }
      const askpass = join(temp, 'askpass.cjs')
      await writeFile(askpass, `#!/usr/bin/env node\nconst map=${JSON.stringify(map)};const p=process.argv[2]||"";const m=p.match(/'([^']+)'/);let h="";try{h=new URL(m&&m[1]).hostname}catch{}const c=map[h];if(!c)process.exit(1);process.stdout.write(p.startsWith("Username")?c.username:c.password)`, { mode: 0o700 })
      env.GIT_ASKPASS = askpass
    }
    const ssh = settings.remotes.filter((remote: Remote) => remote.enabled && remote.authType === 'ssh_key' && remote.secretCiphertext)
    if (ssh.length > 0) {
      const config = []
      for (const remote of ssh) {
        const host = hostOf(remote.url)
        if (!host) continue
        const key = join(temp, `key-${remote.role}`)
        await writeFile(key, service.secrets.decrypt(remote.secretCiphertext), { mode: 0o600 })
        config.push(`Host ${host}\n  HostName ${host}\n  User ${remote.username || 'git'}\n  IdentityFile ${key}\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n`)
      }
      const file = join(temp, 'ssh_config')
      await writeFile(file, config.join('\n'), { mode: 0o600 })
      env.GIT_SSH_COMMAND = `ssh -F ${file} -o IdentitiesOnly=yes`
    }
    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('git', ['-c', 'credential.helper=', ...argv], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let size = 0
      const append = (chunk: Buffer, which: 'out' | 'err') => {
        if (size > 1_000_000) return
        const text = chunk.toString('utf8')
        size += text.length
        if (which === 'out') stdout += text
        else stderr += text
      }
      child.stdout.on('data', chunk => append(chunk, 'out'))
      child.stderr.on('data', chunk => append(chunk, 'err'))
      const timer = setTimeout(() => child.kill('SIGKILL'), options.test ? 30000 : 120000)
      child.on('close', code => { clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout: stdout.slice(-800000), stderr: stderr.slice(-200000) }) })
      child.on('error', cause => { clearTimeout(timer); resolve({ exitCode: 1, stdout: '', stderr: String(cause) }) })
    })
    return { ...result, stdout: redact(result.stdout), stderr: redact(result.stderr) }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}

function hostOf(url: string): string | undefined {
  try { return new URL(url).hostname } catch { /* scp-like ssh URL */ }
  const match = /^(?:[^@]+@)?([^:]+):/.exec(url)
  return match?.[1]
}

function send(response: any, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readJson(request: any): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 65536) throw new Error('请求过大')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
