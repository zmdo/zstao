export type MetricRange = '1h' | '6h' | '24h' | '7d' | '30d'

export interface MetricPoint {
  t: string
  cpu: number
  memory: number
  disk: number
  cpuMax: number
  memoryMax: number
  diskMax: number
}

export interface MetricHistoryDto {
  range: MetricRange | 'custom'
  resolution: 'raw' | '5m' | '1h'
  points: MetricPoint[]
  summary: { cpu: number | null; memory: number | null; disk: number | null } | null
}
