import type { Db } from '../../database/connection.ts'
import type { MetricSample } from '../../remote/parse.ts'

const SAMPLE_RETENTION_SECONDS = 7 * 24 * 3600
const ROLLUP_5M_RETENTION_SECONDS = 30 * 24 * 3600
const ROLLUP_1H_RETENTION_SECONDS = 365 * 24 * 3600

/** Record at most one sample per minute even when the live sampler runs faster. */
export async function recordMetric(db: Db, serverId: string, sample: MetricSample): Promise<void> {
  await db.query<never>(
    `insert into server_metric_samples
       (server_id, cpu_percent, memory_used_bytes, memory_total_bytes, disk_used_bytes, disk_total_bytes)
     select $1, $2, $3, $4, $5, $6
     where not exists (
       select 1 from server_metric_samples
       where server_id=$1 and sampled_at > now() - interval '60 seconds'
     )`,
    [
      serverId,
      sample.cpuPercent,
      sample.memUsedBytes,
      sample.memTotalBytes,
      sample.diskUsedBytes,
      sample.diskTotalBytes,
    ],
  )
}

export async function rollup5m(db: Db, sinceSeconds: number): Promise<void> {
  await db.query<never>(
    `insert into server_metric_rollups_5m
       (server_id, bucket_start, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, disk_max, sample_count)
     select server_id,
            to_timestamp(floor(extract(epoch from sampled_at) / 300) * 300),
            round(avg(cpu_percent), 2),
            round(max(cpu_percent), 2),
            round(avg(100.0 * memory_used_bytes / nullif(memory_total_bytes, 0)), 2),
            round(max(100.0 * memory_used_bytes / nullif(memory_total_bytes, 0)), 2),
            round(avg(100.0 * disk_used_bytes / nullif(disk_total_bytes, 0)), 2),
            round(max(100.0 * disk_used_bytes / nullif(disk_total_bytes, 0)), 2),
            count(*)::int
     from server_metric_samples
     where sampled_at >= now() - make_interval(secs => $1)
     group by 1, 2
     on conflict (server_id, bucket_start) do update set
       cpu_avg=excluded.cpu_avg, cpu_max=excluded.cpu_max,
       memory_avg=excluded.memory_avg, memory_max=excluded.memory_max,
       disk_avg=excluded.disk_avg, disk_max=excluded.disk_max,
       sample_count=excluded.sample_count`,
    [sinceSeconds],
  )
}

export async function rollup1h(db: Db, sinceSeconds: number): Promise<void> {
  await db.query<never>(
    `insert into server_metric_rollups_1h
       (server_id, bucket_start, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, disk_max, sample_count)
     select server_id,
            to_timestamp(floor(extract(epoch from bucket_start) / 3600) * 3600),
            round(avg(cpu_avg), 2),
            round(max(cpu_max), 2),
            round(avg(memory_avg), 2),
            round(max(memory_max), 2),
            round(avg(disk_avg), 2),
            round(max(disk_max), 2),
            sum(sample_count)::int
     from server_metric_rollups_5m
     where bucket_start >= now() - make_interval(secs => $1)
     group by 1, 2
     on conflict (server_id, bucket_start) do update set
       cpu_avg=excluded.cpu_avg, cpu_max=excluded.cpu_max,
       memory_avg=excluded.memory_avg, memory_max=excluded.memory_max,
       disk_avg=excluded.disk_avg, disk_max=excluded.disk_max,
       sample_count=excluded.sample_count`,
    [sinceSeconds],
  )
}

export async function cleanupMetrics(db: Db): Promise<void> {
  await db.query<never>(
    `delete from server_metric_samples where sampled_at < now() - make_interval(secs => $1)`,
    [SAMPLE_RETENTION_SECONDS],
  )
  await db.query<never>(
    `delete from server_metric_rollups_5m where bucket_start < now() - make_interval(secs => $1)`,
    [ROLLUP_5M_RETENTION_SECONDS],
  )
  await db.query<never>(
    `delete from server_metric_rollups_1h where bucket_start < now() - make_interval(secs => $1)`,
    [ROLLUP_1H_RETENTION_SECONDS],
  )
}

export interface RawMetricRow {
  t: Date
  cpu: string | number
  memory: string | number
  disk: string | number
}

export interface RollupMetricRow {
  t: Date
  cpu_avg: string | number
  cpu_max: string | number
  memory_avg: string | number
  memory_max: string | number
  disk_avg: string | number
  disk_max: string | number
  samples: number
}

export async function readRawMetrics(
  db: Db,
  serverId: string,
  from: Date,
  to: Date,
): Promise<RawMetricRow[]> {
  const result = await db.query<RawMetricRow>(
    `select sampled_at as t, cpu_percent as cpu,
            100.0 * memory_used_bytes / nullif(memory_total_bytes, 0) as memory,
            100.0 * disk_used_bytes / nullif(disk_total_bytes, 0) as disk
     from server_metric_samples
     where server_id=$1 and sampled_at >= $2 and sampled_at <= $3
     order by sampled_at`,
    [serverId, from, to],
  )
  return result.rows
}

export async function readRollupMetrics(
  db: Db,
  serverId: string,
  source: '5m' | '1h',
  from: Date,
  to: Date,
): Promise<RollupMetricRow[]> {
  const table = source === '5m' ? 'server_metric_rollups_5m' : 'server_metric_rollups_1h'
  const result = await db.query<RollupMetricRow>(
    `select bucket_start as t, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, disk_max, sample_count as samples
     from ${table}
     where server_id=$1 and bucket_start >= $2 and bucket_start <= $3
     order by bucket_start`,
    [serverId, from, to],
  )
  return result.rows
}
