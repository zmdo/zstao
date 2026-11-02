import type { TaskDto } from '../../shared/dto/tasks.ts'
import { type Db } from '../database/connection.ts'
import { type JobRecord } from '../execution/persistence/rows.ts'
import * as history from './persistence/history-repository.ts'
import * as tasks from './persistence/repository.ts'
import type { TaskQuery } from './query.ts'

export function jobView(row: JobRecord): TaskDto {
  return {
    id: row.id,
    action: row.request_snapshot?.action ?? row.purpose,
    status: row.state,
    phase: row.phase,
    result: row.result,
    output_excerpt: row.output_excerpt,
    created_at: row.created_at.toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
  }
}
export async function readJob(db: Db, id: string) {
  const row = (await tasks.readJob(db, id)).rows[0]
  return row === undefined ? undefined : jobView(row)
}

export async function taskHistory(db: Db, query: TaskQuery) {
  return history.taskHistory(db, query)
}
