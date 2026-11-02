import type { Db } from '../../database/connection.ts'

export interface AuditStart {
  id: string
  kind: 'command' | 'upload' | 'download' | 'transfer'
  serverId: string
  serverName: string
  host: string
  actorId: string
  actorKind: string
  harnessSessionId: string | null
  agentId: string | null
  harnessTurn: number | null
  harnessStep: number | null
  harnessEventSeq: number | null
  toolCallId: string | null
  rootToolCallId: string | null
  parentToolCallId: string | null
  toolName: string
  permissionMode: string
  approvalStatus: string
  approvalId: string | null
  approvedBy: string | null
  approvedAt: Date | null
  approvalReason: string | null
  command: string | null
  commandDigest: string | null
  commandLength: number | null
  commandTruncated: boolean
  redactionApplied: boolean
  cwd: string | null
  remotePath: string | null
  localPath: string | null
  bytes: number | null
  mode: string | null
  overwrite: boolean
  status: string
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  errorCode: string | null
  errorMessage: string | null
  stdoutExcerpt: string | null
  stderrExcerpt: string | null
  stdoutBytes: number | null
  stderrBytes: number | null
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdoutDigest: string | null
  stderrDigest: string | null
  metadata: Record<string, unknown>
}

export interface AuditFinish {
  status: string
  finishedAt: Date
  durationMs: number
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  errorCode: string | null
  errorMessage: string | null
  stdoutExcerpt: string | null
  stderrExcerpt: string | null
  stdoutBytes: number | null
  stderrBytes: number | null
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdoutDigest: string | null
  stderrDigest: string | null
  bytes?: number | null
}

export function insertAudit(db: Db, input: AuditStart) {
  const values = [
    input.id, input.kind, input.serverId, input.serverName, input.host, input.actorId, input.actorKind,
    input.harnessSessionId, input.agentId, input.harnessTurn, input.harnessStep, input.harnessEventSeq,
    input.toolCallId, input.rootToolCallId, input.parentToolCallId, input.toolName,
    input.permissionMode, input.approvalStatus, input.approvalId, input.approvedBy, input.approvedAt,
    input.approvalReason, input.command, input.commandDigest, input.commandLength, input.commandTruncated,
    input.redactionApplied, input.cwd, input.remotePath, input.localPath, input.bytes,
    input.mode, input.overwrite, input.status, input.startedAt, input.finishedAt, input.durationMs,
    input.exitCode, input.signal, input.timedOut, input.cancelled, input.errorCode, input.errorMessage,
    input.stdoutExcerpt, input.stderrExcerpt, input.stdoutBytes, input.stderrBytes, input.stdoutTruncated,
    input.stderrTruncated, input.stdoutDigest, input.stderrDigest, input.metadata,
  ]
  return db.query<never>(
    `insert into server_audit_log(
      id,kind,server_id,server_name,host,actor_id,actor_kind,harness_session_id,agent_id,
      harness_turn,harness_step,harness_event_seq,tool_call_id,root_tool_call_id,parent_tool_call_id,tool_name,
      permission_mode,approval_status,approval_id,approved_by,approved_at,approval_reason,
      command,command_digest,command_length,command_truncated,redaction_applied,cwd,
      remote_path,local_path,bytes,mode,overwrite,
      status,started_at,finished_at,duration_ms,exit_code,signal,timed_out,cancelled,error_code,error_message,
      stdout_excerpt,stderr_excerpt,stdout_bytes,stderr_bytes,stdout_truncated,stderr_truncated,stdout_digest,stderr_digest,metadata
    ) values(${values.map((_, index) => `$${index + 1}`).join(',')})`,
    values,
  )
}

export function finishAudit(db: Db, id: string, input: AuditFinish) {
  return db.query<never>(
    `update server_audit_log set
      status=$2,finished_at=$3,duration_ms=$4,exit_code=$5,signal=$6,timed_out=$7,cancelled=$8,
      error_code=$9,error_message=$10,stdout_excerpt=$11,stderr_excerpt=$12,
      stdout_bytes=$13,stderr_bytes=$14,stdout_truncated=$15,stderr_truncated=$16,
      stdout_digest=$17,stderr_digest=$18,
      bytes=coalesce($19,bytes)
     where id=$1 and status='pending'`,
    [
      id, input.status, input.finishedAt, input.durationMs, input.exitCode, input.signal,
      input.timedOut, input.cancelled, input.errorCode, input.errorMessage,
      input.stdoutExcerpt, input.stderrExcerpt, input.stdoutBytes, input.stderrBytes,
      input.stdoutTruncated, input.stderrTruncated, input.stdoutDigest, input.stderrDigest,
      input.bytes ?? null,
    ],
  )
}
