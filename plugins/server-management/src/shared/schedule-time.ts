import { ServerError } from './errors.ts'
/** Reject nonexistent and ambiguous wall times rather than silently choosing a DST offset. */
export function zonedTime(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || timeZone.length > 100)
    throw new ServerError('schedule_time_invalid')
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  } catch (cause) {
    throw new ServerError('schedule_time_invalid', {}, { cause })
  }
  const wall = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms)),
      get = (key: string) => parts.find((p) => p.type === key)!.value
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
  }
  const naive = Date.parse(value + 'Z')
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value)
    throw new ServerError('schedule_time_invalid')
  const offsets = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3600000
    offsets.add(Date.parse(wall(sample) + 'Z') - sample)
  }
  const matches = [...offsets].map((offset) => naive - offset).filter((ms) => wall(ms) === value)
  if (matches.length !== 1) throw new ServerError('schedule_time_invalid')
  return new Date(matches[0]!).toISOString()
}
