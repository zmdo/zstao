export interface HarnessTrace {
  turn: number | null
  step: number | null
  eventSeq: number | null
}

interface SessionEventLike {
  type: string
  data?: unknown
}

interface SessionLike {
  readonly seq: number
  eventAt(seq: number): SessionEventLike | undefined
}

interface ProjectionService {
  stateOf(session: unknown, key: string): unknown
}

interface TurnBoundary {
  openTurnStartSeq?: number | null
  lastTurn?: number
}

interface AgentLike {
  session?: SessionLike
}

/** Resolve the current turn, step and tool-call event from the live session log. */
export function harnessTrace(agent: unknown, callId: string, projections: ProjectionService | undefined): HarnessTrace {
  const session = (agent as AgentLike | undefined)?.session
  if (session === undefined) return { turn: null, step: null, eventSeq: null }
  const boundary = safeBoundary(session, projections)
  let eventSeq: number | null = null
  for (let seq = Number(session.seq) - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq)
    if (event?.type === 'tool/call' && String((event.data as { callId?: unknown } | undefined)?.callId ?? '') === callId) {
      eventSeq = seq
      break
    }
  }
  const turnStart = boundary?.openTurnStartSeq ?? findTurnStart(session)
  let turn = typeof boundary?.lastTurn === 'number' ? boundary.lastTurn : null
  if (turn === null && turnStart !== null) turn = eventTurn(session, turnStart)
  let step: number | null = null
  if (turnStart !== null) {
    let count = 0
    for (let seq = turnStart; seq < Number(session.seq); seq += 1)
      if (session.eventAt(seq)?.type === 'step/start') count += 1
    step = count === 0 ? null : count
  }
  return { turn, step, eventSeq }
}

function safeBoundary(session: SessionLike, projections: ProjectionService | undefined): TurnBoundary | undefined {
  if (projections === undefined) return undefined
  try {
    return projections.stateOf(session, 'turnBoundary') as TurnBoundary | undefined
  } catch {
    return undefined
  }
}

function findTurnStart(session: SessionLike): number | null {
  for (let seq = Number(session.seq) - 1; seq >= 0; seq -= 1)
    if (session.eventAt(seq)?.type === 'turn/start') return seq
  return null
}

function eventTurn(session: SessionLike, turnStart: number): number | null {
  const data = session.eventAt(turnStart)?.data as { turn?: unknown } | undefined
  return typeof data?.turn === 'number' ? data.turn : null
}
