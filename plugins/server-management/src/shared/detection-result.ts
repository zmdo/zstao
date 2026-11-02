import type { DetectionResult } from './dto/upgrades.ts'
import { isErrorCode } from './errors.ts'
import { displayJobError, serverCopy } from './i18n.ts'

/** Error envelopes are persisted JSON: render their messages, never their serialized representation. */
function messages(active: string, value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.flatMap((item) => messages(active, item, depth + 1))
  if (typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (isErrorCode(record.code)) return [displayJobError(active, record)]
  const nested = ['error', 'errors', 'issues'].flatMap((key) => messages(active, record[key], depth + 1))
  if (nested.length) return nested
  for (const key of ['detail', 'message']) {
    if (typeof record[key] === 'string' && record[key].trim()) return [record[key].trim()]
  }
  return []
}

export function detectionResult(active: string, check: DetectionResult) {
  const copy = serverCopy(active).upgrades
  const reason = check.check_snapshot?.reason
  const details = messages(active, check.check_error)
  const failed = !!check.check_error || reason === 'detection_failed' || reason === 'unhealthy'
  const reasons = [...details]
  // A connection failure may leave an older successful snapshot in place; do not present it as current.
  if (!check.check_error && check.check_snapshot?.before?.state === 'unknown') {
    const detail = check.check_snapshot.before.detail?.trim()
    if (detail) reasons.push(detail)
  }
  let state: 'failed' | 'blocked' | 'available' | 'current' | 'unknown'
  let label: string
  if (failed) {
    state = 'failed'
    label = copy.detection_failed
    if (!reasons.length) reasons.push(reason === 'unhealthy' ? copy.unhealthy : copy.checkFailedHint)
  } else if (reason) {
    state = 'blocked'
    label = copy.blocked
    reasons.push(Object.hasOwn(copy, reason) ? copy[reason as keyof typeof copy] : copy.checkUnavailable)
  } else if (check.check_snapshot?.eligible?.length) {
    state = 'available'
    label = copy.has_updates
    reasons.push(copy.checkAvailableHint)
  } else if (check.check_snapshot) {
    state = 'current'
    label = copy.checkCurrent
    reasons.push(copy.up_to_date)
  } else {
    state = 'unknown'
    label = copy.unknown
    reasons.push(copy.checkUnavailable)
  }
  return { state, label, reasons: [...new Set(reasons)] }
}
