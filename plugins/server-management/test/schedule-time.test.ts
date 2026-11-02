import assert from 'node:assert/strict'
import test from 'node:test'
import { zonedTime } from '../src/shared/schedule-time.ts'

test('maintenance wall times use the selected IANA zone and reject DST gaps and overlaps', () => {
  assert.equal(zonedTime('2026-10-20T10:00', 'Asia/Shanghai'), '2026-10-20T02:00:00.000Z')
  assert.equal(zonedTime('2026-10-20T10:00', 'UTC'), '2026-10-20T10:00:00.000Z')
  assert.equal(zonedTime('2026-07-20T10:00', 'America/New_York'), '2026-07-20T14:00:00.000Z')
  for (const [date, zone] of [
    ['2026-03-08T02:30', 'America/New_York'],
    ['2026-11-01T01:30', 'America/New_York'],
    ['2026-02-30T12:00', 'UTC'],
    ['2026-10-20T10:00', 'invalid'],
  ])
    assert.throws(() => zonedTime(date!, zone!), { code: 'schedule_time_invalid' })
})
