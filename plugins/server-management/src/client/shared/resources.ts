export function meter(percent: number | null, label: string): string {
  if (percent === null || !Number.isFinite(percent)) return '—'
  return `${Math.round(percent)}% ${label === '%' ? '' : label}`.trim()
}

export function ratio(used: number | string | null, total: number | string | null): number | null {
  if (used === null || total === null) return null
  const left = Number(used)
  const right = Number(total)
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= 0) return null
  return Math.max(0, Math.min(100, (100 * left) / right))
}

export function bytes(value: number | string | null): string {
  if (value === null) return '—'
  const size = Number(value)
  if (!Number.isFinite(size)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let next = size
  let index = 0
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024
    index += 1
  }
  return `${index === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[index]}`
}
