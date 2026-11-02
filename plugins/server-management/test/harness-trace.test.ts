import assert from 'node:assert/strict'
import test from 'node:test'
import { harnessTrace } from '../src/host/harness/trace.ts'

const events = [
  { type: 'turn/start', data: { turn: 4 } },
  { type: 'step/start', data: { turn: 4, step: 1 } },
  { type: 'step/start', data: { turn: 4, step: 2 } },
  { type: 'tool/call', data: { callId: 'call-1', turn: 4, step: 2 } },
]
const session = { seq: events.length, eventAt: (seq: number) => events[seq] }

test('harness trace resolves turn, step and tool-call event from the session log', () => {
  assert.deepEqual(harnessTrace({ session }, 'call-1', undefined), { turn: 4, step: 2, eventSeq: 3 })
  assert.deepEqual(harnessTrace({ session }, 'call-1', { stateOf: () => ({ openTurnStartSeq: 0, lastTurn: 4 }) }), { turn: 4, step: 2, eventSeq: 3 })
  assert.deepEqual(harnessTrace(undefined, 'call-1', undefined), { turn: null, step: null, eventSeq: null })
})
