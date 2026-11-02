import { useEffect, useState } from 'react'
import type { MetricHistoryDto, MetricPoint, MetricRange } from '../../../shared/dto/metrics.ts'
import { displayError, serverCopy } from '../../../shared/i18n.ts'
import { api, requestError } from '../../shared/api.ts'
import type { ServerError } from '../../../shared/errors.ts'

const RANGES: MetricRange[] = ['1h', '6h', '24h', '7d', '30d']
const METRICS = [
  { key: 'cpu' as const, label: 'CPU' },
  { key: 'memory' as const, label: 'memory' },
  { key: 'disk' as const, label: 'disk' },
]
type Query = { kind: 'preset'; range: MetricRange } | { kind: 'custom'; from: string; to: string }

export function ResourceHistory(props: { active: string; serverId: string; createdAt: string }) {
  const copy = serverCopy(props.active).ui
  const earliest = toLocalInput(new Date(props.createdAt))
  const now = toLocalInput(new Date())
  const [range, setRange] = useState<MetricRange>('24h')
  const [custom, setCustom] = useState(false)
  const [from, setFrom] = useState(toLocalInput(new Date(Date.now() - 24 * 3600 * 1000)))
  const [to, setTo] = useState(now)
  const [query, setQuery] = useState<Query>({ kind: 'preset', range: '24h' })
  const [data, setData] = useState<MetricHistoryDto>()
  const [error, setError] = useState<ServerError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const key = query.kind === 'preset' ? query.range : `${query.from}/${query.to}`
  const valid = query.kind === 'preset' || (from !== '' && to !== '' && to > from)

  useEffect(() => {
    const controller = new AbortController()
    const search =
      query.kind === 'preset'
        ? `range=${query.range}`
        : `from=${encodeURIComponent(new Date(query.from).toISOString())}&to=${encodeURIComponent(new Date(query.to).toISOString())}`
    setLoading(true)
    setError(null)
    api<MetricHistoryDto>(`/console-api/servers/${props.serverId}/metrics?${search}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) setData(next)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(requestError(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [props.serverId, key, refresh])

  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((current) => current + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const points = data?.points ?? []
  return (
    <section className="smp-resource-history smp-card" aria-label={copy.resourceHistory}>
      <header>
        <h2>{copy.resourceHistory}</h2>
        <div className="smp-resource-ranges" role="tablist" aria-label={copy.resourceHistory}>
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={!custom && range === value}
              className={!custom && range === value ? 'is-on' : ''}
              onClick={() => {
                setCustom(false)
                setRange(value)
                setQuery({ kind: 'preset', range: value })
              }}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={custom}
            className={custom ? 'is-on' : ''}
            onClick={() => setCustom(true)}
          >
            {copy.resourceHistoryCustom}
          </button>
        </div>
      </header>
      {custom && (
        <div className="smp-resource-custom">
          <label>
            {copy.resourceHistoryFrom}
            <input
              type="datetime-local"
              value={from}
              min={earliest}
              max={to || now}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            {copy.resourceHistoryTo}
            <input
              type="datetime-local"
              value={to}
              min={from || earliest}
              max={now}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button
            className="secondary"
            type="button"
            disabled={!valid}
            onClick={() => setQuery({ kind: 'custom', from, to })}
          >
            {copy.resourceHistoryApply}
          </button>
        </div>
      )}
      {error !== null ? (
        <p className="banner error">{displayError(props.active, error)}</p>
      ) : loading && points.length === 0 ? (
        <p className="muted">{copy.loading}</p>
      ) : points.length === 0 ? (
        <p className="muted">{copy.resourceHistoryEmpty}</p>
      ) : (
        <div className="smp-resource-grid">
          {METRICS.map((metric) => (
            <MetricPanel
              key={metric.key}
              copy={copy}
              metric={metric.key}
              label={metric.label}
              points={points}
              long={query.kind === 'custom' || query.kind === 'preset' && (query.range === '7d' || query.range === '30d')}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function MetricPanel(props: {
  copy: ReturnType<typeof serverCopy>['ui']
  metric: 'cpu' | 'memory' | 'disk'
  label: string
  points: MetricPoint[]
  long: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const selected = hover === null ? props.points.at(-1) : props.points[hover]
  const label = props.metric === 'cpu' ? 'CPU' : props.copy[props.metric === 'memory' ? 'memory' : 'disk']
  return (
    <div className="smp-resource-panel">
      <div className="smp-resource-panel-head">
        <span className={`is-${props.metric}`}>{label}</span>
        <b>{selected === undefined ? '—' : `${Math.round(selected[props.metric])}%`}</b>
      </div>
      <div className="smp-resource-chart-wrap">
        <LineChart
          points={props.points}
          metric={props.metric}
          hover={hover}
          onHover={setHover}
          long={props.long}
        />
        {selected !== undefined && hover !== null && (
          <div
            className="smp-chart-tooltip"
            style={{
              left: `${props.points.length <= 1 ? 0 : (hover / (props.points.length - 1)) * 100}%`,
            }}
          >
            <time>{formatFull(selected.t)}</time>
            <span>{Math.round(selected[props.metric])}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

function LineChart(props: {
  points: MetricPoint[]
  metric: 'cpu' | 'memory' | 'disk'
  hover: number | null
  onHover(index: number | null): void
  long: boolean
}) {
  const width = 360
  const height = 150
  const left = 32
  const right = 8
  const top = 8
  const bottom = 20
  const innerWidth = width - left - right
  const innerHeight = height - top - bottom
  const x = (index: number): number =>
    props.points.length <= 1 ? left : left + (index / (props.points.length - 1)) * innerWidth
  const y = (value: number): number => top + (1 - Math.max(0, Math.min(100, value)) / 100) * innerHeight
  const d = props.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point[props.metric]).toFixed(1)}`)
    .join(' ')
  const active = props.hover === null ? undefined : props.points[props.hover]
  return (
    <div className="smp-resource-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${props.metric} history`}
        onMouseLeave={() => props.onHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const position = ((event.clientX - box.left) / box.width) * width
          const ratio = Math.max(0, Math.min(1, (position - left) / innerWidth))
          props.onHover(Math.round(ratio * Math.max(0, props.points.length - 1)))
        }}
      >
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="smp-chart-grid" />
            <text x={left - 6} y={y(tick) + 3} textAnchor="end" className="smp-chart-label">{tick}%</text>
          </g>
        ))}
        <path d={d} className={`smp-chart-line is-${props.metric}`} />
        {props.points.length <= 2 &&
          props.points.map((point, index) => (
            <circle key={point.t} cx={x(index)} cy={y(point[props.metric])} r="2.5" className={`smp-chart-dot is-${props.metric}`} />
          ))}
        {active !== undefined && props.hover !== null && (
          <>
            <line x1={x(props.hover)} x2={x(props.hover)} y1={top} y2={height - bottom} className="smp-chart-cursor" />
            <circle cx={x(props.hover)} cy={y(active[props.metric])} r="3" className={`smp-chart-dot is-${props.metric}`} />
          </>
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const index = Math.round(fraction * (props.points.length - 1))
          return (
            <g key={fraction}>
              <line x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} className="smp-chart-grid-vertical" />
              <text
                x={x(index)}
                y={height - 4}
                textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
                className="smp-chart-label"
              >
                {formatPoint(props.points[index]!.t, props.long)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function formatPoint(value: string, long: boolean): string {
  const date = new Date(value)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return long
    ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time}`
    : time
}

function formatFull(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
