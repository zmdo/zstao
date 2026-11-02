export class ParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ParseError'
  }
}

export function excerpt(text: string, limit = 8000): string {
  const cleaned = text.trim()
  if (cleaned.length <= limit) return cleaned
  return `…\n${cleaned.slice(-limit)}`
}

export function scrub(text: string, secret: string): string {
  if (secret.length >= 4 && text.includes(secret)) return text.replaceAll(secret, '***')
  return text
}

export interface MetricSample {
  cpuModel: string | null
  cpuCores: number
  cpuPercent: number
  memTotalBytes: number
  memUsedBytes: number
  diskTotalBytes: number
  diskUsedBytes: number
}

export function parseSample(text: string): MetricSample {
  const lines = text.trim().split(/\r?\n/)
  const parts = (lines[0] ?? '').trim().split(/\s+/)
  if (parts.length !== 9) throw new ParseError('采集结果无法解析')
  const [cores, aTotal, aIdle, bTotal, bIdle, memTotalKb, memAvailKb, diskTotal, diskUsed] = parts.map(
    (part) => Number(part),
  )
  if (
    [cores, aTotal, aIdle, bTotal, bIdle, memTotalKb, memAvailKb, diskTotal, diskUsed].some(
      (item) => !Number.isFinite(item),
    )
  ) {
    throw new ParseError('采集结果无法解析')
  }
  if ((cores ?? 0) < 1 || (memTotalKb ?? 0) < 1 || (diskTotal ?? 0) < 1)
    throw new ParseError('采集结果无法解析')
  const delta = (bTotal ?? 0) - (aTotal ?? 0)
  const idle = (bIdle ?? 0) - (aIdle ?? 0)
  const cpu = delta <= 0 ? 0 : Math.round((100 * (delta - idle)) / delta)
  const memTotal = (memTotalKb ?? 0) * 1024
  const memUsed = Math.max(0, ((memTotalKb ?? 0) - (memAvailKb ?? 0)) * 1024)
  return {
    cpuModel: lines[1]?.trim() || null,
    cpuCores: cores ?? 0,
    cpuPercent: Math.max(0, Math.min(100, cpu)),
    memTotalBytes: memTotal,
    memUsedBytes: Math.min(memUsed, memTotal),
    diskTotalBytes: diskTotal ?? 0,
    diskUsedBytes: Math.max(0, Math.min(diskUsed ?? 0, diskTotal ?? 0)),
  }
}

/** Sanitize string leaves before JSON encoding so quoted or multiline secrets are also removed. */
export function scrubValue<T>(value: T, secret: string): T {
  const visit = (item: unknown): unknown =>
    typeof item === 'string'
      ? scrub(item, secret)
      : Array.isArray(item)
        ? item.map(visit)
        : item !== null && typeof item === 'object'
          ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]))
          : item
  return visit(value) as T
}
