import type { Db } from '../database/connection.ts'
import type { MetricHistoryDto, MetricPoint, MetricRange } from '../../shared/dto/metrics.ts'
import { readRawMetrics, readRollupMetrics, type RawMetricRow, type RollupMetricRow } from './persistence/history-repository.ts'

const RANGES: Record<MetricRange, { seconds: number; step: number; source: 'raw' | '5m' | '1h' }> = {
  '1h': { seconds: 3600, step: 60, source: 'raw' },
  '6h': { seconds: 6 * 3600, step: 60, source: 'raw' },
  '24h': { seconds: 24 * 3600, step: 300, source: 'raw' },
  '7d': { seconds: 7 * 24 * 3600, step: 900, source: '5m' },
  '30d': { seconds: 30 * 24 * 3600, step: 3600, source: '1h' },
}

interface WindowConfig {
  step: number
  source: 'raw' | '5m' | '1h'
}
interface Bucket {
  t: number
  cpu: number
  cpuMax: number
  memory: number
  memoryMax: number
  disk: number
  diskMax: number
  weight: number
}

export function metricRange(value: string | null): MetricRange | null {
  return value !== null && Object.hasOwn(RANGES, value) ? (value as MetricRange) : null
}

export async function metricHistory(
  db: Db,
  serverId: string,
  range: MetricRange,
): Promise<MetricHistoryDto> {
  const config = RANGES[range]
  const to = new Date()
  const from = new Date(to.getTime() - config.seconds * 1000)
  return readHistory(db, serverId, range, from, to, config, true)
}

export async function metricHistoryCustom(
  db: Db,
  serverId: string,
  from: Date,
  to: Date,
): Promise<MetricHistoryDto> {
  const seconds = Math.max(1, Math.floor((to.getTime() - from.getTime()) / 1000))
  const config =
    seconds <= 6 * 3600
      ? { step: 60, source: 'raw' as const }
      : seconds <= 24 * 3600
        ? { step: 300, source: 'raw' as const }
        : seconds <= 7 * 24 * 3600
          ? { step: 900, source: '5m' as const }
          : seconds <= 30 * 24 * 3600
            ? { step: 3600, source: '5m' as const }
            : {
                step: Math.max(3600, Math.ceil(seconds / 720 / 3600) * 3600),
                source: '1h' as const,
              }
  return readHistory(db, serverId, 'custom', from, to, config, true)
}

async function readHistory(
  db: Db,
  serverId: string,
  range: MetricRange | 'custom',
  from: Date,
  to: Date,
  config: WindowConfig,
  fallback: boolean,
): Promise<MetricHistoryDto> {
  let rows: (RawMetricRow | RollupMetricRow)[] =
    config.source === 'raw'
      ? await readRawMetrics(db, serverId, from, to)
      : await readRollupMetrics(db, serverId, config.source, from, to)
  let resolution = config.source
  if (rows.length === 0 && fallback && config.source !== 'raw') {
    rows = await readRawMetrics(db, serverId, from, to)
    resolution = 'raw'
  }
  const buckets = new Map<number, Bucket>()
  for (const row of rows) {
    const t = new Date(row.t).getTime()
    const key = Math.floor(t / (config.step * 1000)) * config.step * 1000
    const current = buckets.get(key)
    const cpu = Number('cpu' in row ? row.cpu : row.cpu_avg)
    const memory = Number('memory' in row ? row.memory : row.memory_avg)
    const disk = Number('disk' in row ? row.disk : row.disk_avg)
    const samples = 'samples' in row ? row.samples : 1
    const cpuMax = Number('cpu' in row ? row.cpu : row.cpu_max)
    const memoryMax = Number('memory' in row ? row.memory : row.memory_max)
    const diskMax = Number('disk' in row ? row.disk : row.disk_max)
    if (current === undefined) {
      buckets.set(key, {
        t: key,
        cpu: cpu * samples,
        cpuMax,
        memory: memory * samples,
        memoryMax,
        disk: disk * samples,
        diskMax,
        weight: samples,
      })
      continue
    }
    current.cpu += cpu * samples
    current.memory += memory * samples
    current.disk += disk * samples
    current.weight += samples
    current.cpuMax = Math.max(current.cpuMax, cpuMax)
    current.memoryMax = Math.max(current.memoryMax, memoryMax)
    current.diskMax = Math.max(current.diskMax, diskMax)
  }
  const points: MetricPoint[] = [...buckets.values()]
    .sort((a, b) => a.t - b.t)
    .map((bucket) => ({
      t: new Date(bucket.t).toISOString(),
      cpu: round(bucket.cpu / bucket.weight),
      memory: round(bucket.memory / bucket.weight),
      disk: round(bucket.disk / bucket.weight),
      cpuMax: round(bucket.cpuMax),
      memoryMax: round(bucket.memoryMax),
      diskMax: round(bucket.diskMax),
    }))
  const last = points.at(-1)
  return {
    range,
    resolution,
    points,
    summary: last === undefined ? null : { cpu: last.cpu, memory: last.memory, disk: last.disk },
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
