import { createHash, randomUUID } from 'node:crypto'
import { serverSecret } from '../servers/persistence/credential-repository.ts'
import { connectSsh, type SshSession } from '../remote/ssh.ts'
import { finishAudit, insertAudit, type AuditFinish, type AuditStart } from '../audit/persistence/write-repository.ts'
import { getHarnessServer, type HarnessDeps } from './service.ts'
import { authorizeOperation, type SessionPermission } from './authorization.ts'

const AUDIT_EXCERPT = 4 * 1024

export interface ExecLimits {
  defaultTimeoutMs: number
  maxTimeoutMs: number
  defaultCommandBytes: number
  maxCommandBytes: number
  defaultOutputBytes: number
  maxOutputBytes: number
  rsyncDeniedFlags: string[]
}

export const DEFAULT_EXEC_LIMITS: ExecLimits = {
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  defaultCommandBytes: 8 * 1024,
  maxCommandBytes: 8 * 1024,
  defaultOutputBytes: 64 * 1024,
  maxOutputBytes: 1024 * 1024,
  rsyncDeniedFlags: [
    '-e', '--rsh', '--rsync-path',
    '--delete', '--delete-before', '--delete-after', '--delete-during',
    '--delete-delay', '--delete-excluded', '--delete-missing-args',
    '--remove-source-files', '--files-from', '--password-file',
    '--write-batch', '--read-batch', '--daemon', '--server', '--sender',
    '--config', '--temp-dir', '--log-file', '--backup-dir',
    '--link-dest', '--copy-dest', '--compare-dest', '--filter',
    '--exclude-from', '--include-from',
  ],
}

export interface ExecArgs {
  server: string
  command: string
  timeout_ms?: number
  command_max_bytes?: number
  output_limit_bytes?: number
}

export interface ExecContext {
  agent?: { id: string; session?: unknown }
  callId: string
  rootCallId?: string
  signal: AbortSignal
  permission?: () => SessionPermission
  harnessTurn?: number | null
  harnessStep?: number | null
  harnessEventSeq?: number | null
}

export interface ApprovalRequester {
  request(request: {
    agent: { id: string; session?: unknown }
    toolName: string
    kind?: 'exec' | 'transfer'
    callId: string
    reason?: string
    displayReason?: { en: string; [locale: string]: string }
    signal?: AbortSignal
  }): Promise<string>
}

export async function executeHarnessCommand(
  deps: HarnessDeps,
  args: ExecArgs,
  exec: ExecContext,
  approval: ApprovalRequester | undefined,
): Promise<string> {
  const limits = deps.execLimits ?? DEFAULT_EXEC_LIMITS
  const command = args.command
  const commandBytes = Buffer.byteLength(command, 'utf8')
  if (commandBytes === 0) throw toolError('command_required', 'A command is required.')
  const commandLimit = args.command_max_bytes ?? limits.defaultCommandBytes
  if (!Number.isSafeInteger(commandLimit) || commandLimit < 1 || commandLimit > limits.maxCommandBytes)
    throw toolError('invalid_command_limit', `command_max_bytes must be between 1 and ${limits.maxCommandBytes}.`)
  if (commandBytes > commandLimit)
    throw toolError('command_too_long', `Command must be at most ${commandLimit} bytes.`)
  const timeoutMs = resolveTimeout(args.timeout_ms, limits)
  const outputLimit = args.output_limit_bytes ?? limits.defaultOutputBytes
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > limits.maxOutputBytes)
    throw toolError('invalid_output_limit', `output_limit_bytes must be between 1 and ${limits.maxOutputBytes}.`)
  const target = await getHarnessServer(deps, args.server)
  const secret = await serverSecret(deps.db, target.id)
  if (secret === undefined) throw toolError('server_not_managed', 'The server is no longer managed by this platform.')

  const now = new Date()
  const auditId = randomUUID()
  const redacted = redact(command)
  const auditBase: Omit<AuditStart, 'approvalStatus' | 'approvalId' | 'approvedBy' | 'approvedAt' | 'approvalReason' | 'status' | 'startedAt' | 'finishedAt' | 'durationMs' | 'exitCode' | 'signal' | 'timedOut' | 'cancelled' | 'errorCode' | 'errorMessage' | 'stdoutExcerpt' | 'stderrExcerpt' | 'stdoutBytes' | 'stderrBytes' | 'stdoutTruncated' | 'stderrTruncated' | 'stdoutDigest' | 'stderrDigest'> = {
    id: auditId,
    kind: 'command',
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
    toolName: 'platform_server_exec',
    permissionMode: 'exec',
    command: redacted,
    commandDigest: sha256(command),
    commandLength: commandBytes,
    commandTruncated: false,
    redactionApplied: redacted !== command,
    cwd: null,
    remotePath: null,
    localPath: null,
    bytes: null,
    mode: null,
    overwrite: false,
    metadata: {},
  }

  const decision = await authorizeOperation(exec, approval, () => ({
    toolName: 'platform_server_exec',
    reason: `Run a command on managed server ${target.name}: ${command.slice(0, 200)}`,
    displayReason: {
      en: `Allow this command to run on ${target.name}?`,
      zh: `是否允许在服务器 ${target.name} 上执行这条命令？`,
    },
  }))
  if (!decision.allowed) {
    const approvalOutcome = decision.outcome
    const status = 'denied'
    await insertAudit(deps.db, {
      ...auditBase,
      approvalStatus: 'denied',
      approvalId: null,
      approvedBy: null,
      approvedAt: null,
      approvalReason: approvalOutcome === 'unavailable' ? 'Approval channel unavailable' : `Approval ${approvalOutcome}`,
      status,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: false,
      errorCode: 'approval_denied',
      errorMessage: `Approval was not granted: ${approvalOutcome}`,
      stdoutExcerpt: null,
      stderrExcerpt: null,
      stdoutBytes: null,
      stderrBytes: null,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutDigest: null,
      stderrDigest: null,
    })
    throw toolError('approval_denied', `Approval was not granted: ${approvalOutcome}`)
  }

  const startedAt = new Date()
  const { authorization } = decision
  const fullAccess = authorization.source === 'full-access'
  await insertAudit(deps.db, {
    ...auditBase,
    permissionMode: authorization.permissionMode ?? auditBase.permissionMode,
    metadata: { ...auditBase.metadata, authorization_source: authorization.source },
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

  let session: SshSession | undefined
  const onAbort = () => session?.close()
  exec.signal.addEventListener('abort', onAbort, { once: true })
  const started = Date.now()
  try {
    if (exec.signal.aborted) throw toolError('cancelled', 'The execution was cancelled.')
    session = await (deps.connect ?? connectSsh)({
      host: secret.host,
      port: secret.ssh_port,
      username: secret.ssh_user,
      authMethod: secret.auth_method,
      secret: deps.secrets!.decrypt(secret.secret_ciphertext),
      expectedFingerprint: secret.host_fingerprint,
    })
    if (exec.signal.aborted) throw toolError('cancelled', 'The execution was cancelled.')
    const result = await session.exec(command, timeoutMs, { outputLimitBytes: limits.maxOutputBytes })
    const durationMs = Date.now() - started
    const stdout = excerpt(result.stdout, outputLimit)
    const stderr = excerpt(result.stderr, outputLimit)
    const stdoutBytes = Buffer.byteLength(result.stdout)
    const stderrBytes = Buffer.byteLength(result.stderr)
    const status = result.code === 0 ? 'succeeded' : 'failed'
    await finishAudit(deps.db, auditId, {
      status,
      finishedAt: new Date(),
      durationMs,
      exitCode: result.code,
      signal: null,
      timedOut: false,
      cancelled: false,
      errorCode: status === 'failed' ? 'command_exit_nonzero' : null,
      errorMessage: status === 'failed' ? `Command exited with code ${result.code}` : null,
      stdoutExcerpt: redact(excerpt(result.stdout, AUDIT_EXCERPT).text),
      stderrExcerpt: redact(excerpt(result.stderr, AUDIT_EXCERPT).text),
      stdoutBytes,
      stderrBytes,
      stdoutTruncated: stdoutBytes > AUDIT_EXCERPT,
      stderrTruncated: stderrBytes > AUDIT_EXCERPT,
      stdoutDigest: sha256(result.stdout),
      stderrDigest: sha256(result.stderr),
    })
    return JSON.stringify({
      exit_code: result.code,
      stdout: stdout.text,
      stderr: stderr.text,
      stdout_truncated: stdout.truncated,
      stderr_truncated: stderr.truncated,
      duration_ms: durationMs,
    })
  } catch (cause) {
    const durationMs = Date.now() - started
    const cancelled = exec.signal.aborted
    const timedOut = !cancelled && errorCode(cause) === 'command_timeout'
    const status = cancelled ? 'cancelled' : timedOut ? 'timeout' : 'failed'
    const message = cause instanceof Error ? cause.message : String(cause)
    await finishAudit(deps.db, auditId, {
      status,
      finishedAt: new Date(),
      durationMs,
      exitCode: null,
      signal: cancelled ? 'SIGABRT' : null,
      timedOut,
      cancelled,
      errorCode: cancelled ? 'cancelled' : timedOut ? 'timeout' : errorCode(cause) ?? 'execution_failed',
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
    throw toolError(status === 'cancelled' ? 'cancelled' : status === 'timeout' ? 'timeout' : 'execution_failed', message)
  } finally {
    exec.signal.removeEventListener('abort', onAbort)
    session?.close()
  }
}

function resolveTimeout(value: number | undefined, limits: ExecLimits): number {
  const timeout = value ?? limits.defaultTimeoutMs
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > limits.maxTimeoutMs)
    throw toolError('invalid_timeout', `timeout_ms must be between 1 and ${limits.maxTimeoutMs}.`)
  return timeout
}

function excerpt(value: string, limit: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= limit) return { text: value, truncated: false }
  return { text: buffer.subarray(0, limit).toString('utf8').replace(/\uFFFD$/, ''), truncated: true }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function redact(command: string): string {
  return command
    .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED KEY]')
}

function errorCode(cause: unknown): string | undefined {
  return typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined
}

function toolError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
