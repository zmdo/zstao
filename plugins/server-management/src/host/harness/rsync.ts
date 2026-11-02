import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseShell } from 'shell-quote'
import { getHarnessServer, type HarnessDeps } from './service.ts'
import { DEFAULT_EXEC_LIMITS, type ApprovalRequester, type ExecContext } from './exec.ts'
import { serverSecret } from '../servers/persistence/credential-repository.ts'
import { finishAudit, insertAudit, type AuditStart } from '../audit/persistence/write-repository.ts'
import { authorizeOperation } from './authorization.ts'

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MAX_TIMEOUT_MS = 10 * 60_000
const MAX_COMMAND_BYTES = 64 * 1024
const AUDIT_EXCERPT = 4 * 1024

const VALUE_LONG = new Set([
  '--rsh', '--rsync-path', '--exclude', '--include', '--filter', '--files-from',
  '--password-file', '--log-file', '--temp-dir', '--backup-dir', '--link-dest',
  '--copy-dest', '--compare-dest', '--bwlimit', '--timeout', '--max-size',
  '--max-delete', '--chmod', '--chown', '--usermap', '--groupmap', '--out-format',
  '--suffix', '--partial-dir', '--compress-level', '--skip-compress',
  '--exclude-from', '--include-from', '--info', '--debug', '--rsh',
])
const VALUE_SHORT = new Set(['e', 'f', 'T', 'B', 'M'])

export interface RsyncArgs {
  server: string
  command: string
  timeout_ms?: number
}

export interface ParsedRsync {
  argv: string[]
  flags: string[]
  operands: string[]
  remote: RemoteTarget[]
}

export interface RemoteTarget {
  raw: string
  user: string | null
  host: string
  path: string
}

export async function executeHarnessRsync(
  deps: HarnessDeps,
  args: RsyncArgs,
  exec: ExecContext,
  approval: ApprovalRequester | undefined,
  workspace: string | undefined,
): Promise<string> {
  const target = await getHarnessServer(deps, args.server)
  const secret = await serverSecret(deps.db, target.id)
  if (secret === undefined) throw toolError('server_not_managed', 'The server is no longer managed by this platform.')
  if (secret.auth_method !== 'private_key') throw toolError('rsync/auth-unsupported', 'rsync proxy currently requires SSH private-key authentication.')
  const limits = deps.execLimits
  const deniedFlags = limits?.rsyncDeniedFlags ?? DEFAULT_EXEC_LIMITS.rsyncDeniedFlags
  const parsed = parseRsyncCommand(args.command, deniedFlags)
  assertServerBound(parsed, target, secret)
  const timeoutMs = normalizeTimeout(args.timeout_ms)
  const auditId = randomUUID()
  const commandBytes = Buffer.byteLength(args.command, 'utf8')
  const remote = parsed.remote[0]
  const local = parsed.operands.find((operand) => !isRemoteSpec(operand)) ?? null
  const base: Omit<AuditStart, 'approvalStatus' | 'approvalId' | 'approvedBy' | 'approvedAt' | 'approvalReason' | 'status' | 'startedAt' | 'finishedAt' | 'durationMs' | 'exitCode' | 'signal' | 'timedOut' | 'cancelled' | 'errorCode' | 'errorMessage' | 'stdoutExcerpt' | 'stderrExcerpt' | 'stdoutBytes' | 'stderrBytes' | 'stdoutTruncated' | 'stderrTruncated' | 'stdoutDigest' | 'stderrDigest'> = {
    id: auditId,
    kind: 'transfer',
    serverId: target.id,
    serverName: target.name,
    host: target.host,
    actorId: 'harness',
    actorKind: 'harness',
    harnessSessionId: exec.agent?.id ?? null,
    agentId: exec.agent?.id ?? null,
    harnessTurn: exec.harnessTurn ?? null,
    harnessStep: exec.harnessStep ?? null,
    harnessEventSeq: exec.harnessEventSeq ?? null,
    toolCallId: exec.callId,
    rootToolCallId: exec.rootCallId ?? exec.callId,
    parentToolCallId: null,
    toolName: 'platform_server_rsync',
    permissionMode: 'transfer',
    command: args.command,
    commandDigest: sha256(args.command),
    commandLength: commandBytes,
    commandTruncated: false,
    redactionApplied: false,
    cwd: workspace ?? null,
    remotePath: remote?.path ?? null,
    localPath: local,
    bytes: null,
    mode: null,
    overwrite: false,
    metadata: {
      argv: parsed.argv,
      flags: parsed.flags,
      denied_flags: deniedFlags,
      remote: remote?.host ?? null,
    },
  }
  const decision = await authorizeOperation(exec, approval, () => ({
    toolName: 'platform_server_rsync', kind: 'transfer',
    reason: `rsync on ${target.name}: ${args.command.slice(0, 500)}`,
    displayReason: { en: `Run rsync on ${target.name}?`, zh: `是否在服务器 ${target.name} 上执行 rsync 传输？` },
  }))
  if (!decision.allowed) {
    const outcome = decision.outcome
    const now = new Date()
    await insertAudit(deps.db, {
      ...base,
      approvalStatus: 'denied',
      approvalId: null,
      approvedBy: null,
      approvedAt: null,
      approvalReason: outcome === 'unavailable' ? 'Approval channel unavailable' : `Approval ${outcome}`,
      status: 'denied',
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: false,
      errorCode: 'approval_denied',
      errorMessage: `Approval was not granted: ${outcome}`,
      stdoutExcerpt: null,
      stderrExcerpt: null,
      stdoutBytes: null,
      stderrBytes: null,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutDigest: null,
      stderrDigest: null,
    })
    throw toolError('approval_denied', `Approval was not granted: ${outcome}`)
  }
  const startedAt = new Date()
  const { authorization } = decision
  const fullAccess = authorization.source === 'full-access'
  await insertAudit(deps.db, {
    ...base,
    permissionMode: authorization.permissionMode ?? base.permissionMode,
    metadata: { ...base.metadata, authorization_source: authorization.source },
    approvalStatus: fullAccess ? 'not_required' : 'approved',
    approvalId: null,
    approvedBy: null,
    approvedAt: fullAccess ? null : startedAt,
    approvalReason: null,
    status: 'pending',
    startedAt,
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    errorCode: null,
    errorMessage: null,
    stdoutExcerpt: null,
    stderrExcerpt: null,
    stdoutBytes: null,
    stderrBytes: null,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutDigest: null,
    stderrDigest: null,
  })
  const started = Date.now()
  let tempDir: string | undefined
  try {
    exec.signal.throwIfAborted()
    tempDir = await mkdtemp(join(tmpdir(), 'smp-rsync-'))
    const keyFile = join(tempDir, 'id_key')
    const knownHosts = join(tempDir, 'known_hosts')
    if (deps.secrets === undefined) throw toolError('secrets_unavailable', 'Server credentials are unavailable.')
    await writeFile(keyFile, deps.secrets.decrypt(secret.secret_ciphertext), { mode: 0o600 })
    await chmod(keyFile, 0o600)
    const hostKeyType = await writeKnownHost(target.host, secret.ssh_port, secret.host_fingerprint, knownHosts)
    const rsh = `ssh -i ${quote(keyFile)} -p ${secret.ssh_port} -o HostKeyAlgorithms=${hostKeyType} -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(knownHosts)} -o GlobalKnownHostsFile=/dev/null`
    const result = await runRsync(parsed.argv.slice(1), workspace ?? process.cwd(), { ...process.env, RSYNC_RSH: rsh }, timeoutMs, exec.signal, limits?.maxOutputBytes ?? 1024 * 1024)
    const durationMs = Date.now() - started
    const status = result.code === 0 ? 'succeeded' : 'failed'
    const bytes = status === 'succeeded' ? parseTotalBytes(result.stdout) : null
    await finishAudit(deps.db, auditId, {
      status,
      finishedAt: new Date(),
      durationMs,
      exitCode: result.code,
      signal: result.signal,
      timedOut: false,
      cancelled: false,
      errorCode: status === 'failed' ? 'rsync_exit_nonzero' : null,
      errorMessage: status === 'failed' ? `rsync exited with code ${result.code}` : null,
      stdoutExcerpt: excerpt(result.stdout),
      stderrExcerpt: excerpt(result.stderr),
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      stdoutDigest: sha256(result.stdout),
      stderrDigest: sha256(result.stderr),
      bytes: bytes ?? null,
    })
    return JSON.stringify({ exit_code: result.code, stdout: result.stdout, stderr: result.stderr, stdout_truncated: result.stdoutTruncated, stderr_truncated: result.stderrTruncated, duration_ms: durationMs })
  } catch (cause) {
    const cancelled = exec.signal.aborted
    const timedOut = errorCode(cause) === 'rsync/timeout'
    const durationMs = Date.now() - started
    const message = cause instanceof Error ? cause.message : String(cause)
    await finishAudit(deps.db, auditId, {
      status: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'failed',
      finishedAt: new Date(),
      durationMs,
      exitCode: null,
      signal: cancelled ? 'SIGTERM' : null,
      timedOut,
      cancelled,
      errorCode: cancelled ? 'cancelled' : timedOut ? 'rsync/timeout' : errorCode(cause) ?? 'rsync/failed',
      errorMessage: message,
      stdoutExcerpt: null,
      stderrExcerpt: null,
      stdoutBytes: null,
      stderrBytes: null,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutDigest: null,
      stderrDigest: null,
    })
    throw cause
  } finally {
    if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true })
  }
}

export function parseRsyncCommand(command: string, deniedFlags: readonly string[]): ParsedRsync {
  const bytes = Buffer.byteLength(command, 'utf8')
  if (command.trim() === '') throw toolError('rsync/command-required', 'A complete rsync command is required.')
  if (bytes > MAX_COMMAND_BYTES) throw toolError('rsync/command-too-long', `Command must be at most ${MAX_COMMAND_BYTES} bytes.`)
  if (/[\u0000-\u001f\u007f]/.test(command)) throw toolError('rsync/unsupported-shell-syntax', 'Control characters are not allowed.')
  if (command.includes('`') || command.includes('$')) throw toolError('rsync/unsupported-shell-syntax', 'Shell expansion is not allowed.')
  let entries: unknown[]
  try { entries = parseShell(command) } catch { throw toolError('rsync/invalid-command', 'The command could not be parsed.') }
  if (entries.some((entry) => typeof entry !== 'string')) throw toolError('rsync/unsupported-shell-syntax', 'Shell operators, globs and substitutions are not allowed.')
  const argv = entries as string[]
  if (argv[0] !== 'rsync') throw toolError('rsync/command-required', 'The command must start with rsync.')
  const flags: string[] = []
  const operands: string[] = []
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '--') { operands.push(...argv.slice(i + 1)); break }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const flag = (eq === -1 ? token : token.slice(0, eq)).toLowerCase()
      flags.push(flag)
      checkDenied(flag, deniedFlags)
      if (eq === -1 && VALUE_LONG.has(flag)) i++
      continue
    }
    if (token.startsWith('-') && token.length > 1) {
      const chars = token.slice(1)
      for (let j = 0; j < chars.length; j++) {
        const flag = `-${chars[j]}`
        flags.push(flag)
        checkDenied(flag, deniedFlags)
        if (VALUE_SHORT.has(chars[j]!)) {
          if (j === chars.length - 1) i++
          break
        }
      }
      continue
    }
    operands.push(token)
  }
  const remote = operands.map(remoteTarget).filter((item): item is RemoteTarget => item !== undefined)
  for (const item of remote) {
    if (/[\u0000-\u001f;&|<>`$()\\]/.test(item.path)) throw toolError('rsync/unsupported-shell-syntax', 'Remote paths may not contain shell control characters.')
  }
  if (remote.length === 0) throw toolError('rsync/server-required', 'The command must contain a remote host:path operand.')
  return { argv, flags, operands, remote }
}

function checkDenied(flag: string, deniedFlags: readonly string[]): void {
  const denied = new Set(deniedFlags.map((value) => canonicalFlag(value)))
  const canonical = canonicalFlag(flag)
  if (denied.has(canonical) || (canonical.startsWith('--delete-') && denied.has('--delete')))
    throw Object.assign(toolError('rsync/flag-denied', `rsync flag is disabled by policy: ${flag}`), { flag })
}

function canonicalFlag(flag: string): string {
  const value = flag.toLowerCase()
  if (value === '-e') return '--rsh'
  return value
}

function remoteTarget(value: string): RemoteTarget | undefined {
  if (value.startsWith('-')) return undefined
  if (value.startsWith('rsync://')) throw toolError('rsync/server-mismatch', 'rsync daemon URLs are not allowed.')
  const match = /^(?:([^@\s]+)@)?(\[[^\]]+\]|[^:/\s]+):(.+)$/.exec(value)
  if (match === null) return undefined
  return { raw: value, user: match[1] ?? null, host: match[2]!.replace(/^\[|\]$/g, ''), path: match[3]! }
}

function isRemoteSpec(value: string): boolean {
  return remoteTarget(value) !== undefined
}

function assertServerBound(parsed: ParsedRsync, target: { name: string; host: string }, secret: { ssh_user: string }): void {
  const allowed = new Set([target.host.toLowerCase(), target.name.toLowerCase()])
  for (const remote of parsed.remote) {
    if (!allowed.has(remote.host.toLowerCase())) throw toolError('rsync/server-mismatch', `Remote host ${remote.host} does not belong to ${target.name}.`)
    if (remote.user !== null && remote.user !== secret.ssh_user) throw toolError('rsync/server-mismatch', `Remote user ${remote.user} does not match the managed server user.`)
  }
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > MAX_TIMEOUT_MS) throw toolError('rsync/invalid-timeout', `timeout_ms must be between 1000 and ${MAX_TIMEOUT_MS}.`)
  return timeout
}

async function writeKnownHost(host: string, port: number, fingerprint: string | null, destination: string): Promise<string> {
  const output = await capture('ssh-keyscan', ['-T', '10', '-p', String(port), host], 15_000)
  const lines = output.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'))
  const match = fingerprint === null ? lines[0] : lines.find((line) => fingerprintOf(line) === fingerprint)
  if (match === undefined) throw toolError('rsync/fingerprint-mismatch', 'SSH host key verification failed.')
  await writeFile(destination, `${match}\n`, { mode: 0o600 })
  return match.trim().split(/\s+/)[1]!
}

function fingerprintOf(line: string): string {
  const parts = line.trim().split(/\s+/)
  const encoded = parts[2] ?? ''
  return `SHA256:${createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('base64').replace(/=+$/, '')}`
}

function runRsync(args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal: AbortSignal, outputLimit: number): Promise<{ code: number; signal: string | null; stdout: string; stderr: string; stdoutBytes: number; stderrBytes: number; stdoutTruncated: boolean; stderrTruncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('rsync', args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''; let stdoutBytes = 0; let stderrBytes = 0
    let timedOut = false
    const kill = (error?: Error) => {
      if (child.pid !== undefined) { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') } }
      if (error !== undefined) reject(error)
    }
    const timer = setTimeout(() => { timedOut = true; kill(toolError('rsync/timeout', `rsync timed out after ${timeoutMs}ms.`)) }, timeoutMs)
    const abort = () => kill(toolError('cancelled', 'Transfer cancelled.'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    const collect = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const text = chunk.toString()
      if (target === 'stdout') { stdoutBytes += chunk.length; if (stdout.length < AUDIT_EXCERPT) stdout += text } else { stderrBytes += chunk.length; if (stderr.length < AUDIT_EXCERPT) stderr += text }
    }
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'))
    child.on('error', (cause) => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(cause) })
    child.on('close', (code, signalName) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort)
      if (timedOut) return
      resolve({ code: code ?? 1, signal: signalName ?? null, stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated: stdoutBytes > AUDIT_EXCERPT, stderrTruncated: stderrBytes > AUDIT_EXCERPT })
    })
  })
}

function capture(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(toolError('rsync/timeout', `${command} timed out.`)) }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (cause) => { clearTimeout(timer); reject(cause) })
    child.on('close', (code) => { clearTimeout(timer); if (code === 0 && stdout.trim() !== '') resolve(stdout); else reject(toolError('rsync/fingerprint-mismatch', `${command} failed: ${stderr.trim()}`)) })
  })
}

function parseTotalBytes(stdout: string): number | null {
  const match = /total size is\s+([\d,]+)/i.exec(stdout)
  if (match === null) return null
  const value = Number(match[1]!.replaceAll(',', ''))
  return Number.isSafeInteger(value) ? value : null
}

function excerpt(value: string): string { return value.length > AUDIT_EXCERPT ? value.slice(0, AUDIT_EXCERPT) : value }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }
function errorCode(cause: unknown): string | undefined { return typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : undefined }
function toolError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }) }
