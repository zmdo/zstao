import type { Db } from '../database/connection.ts'
import { extensionObservations } from './persistence/observation-repository.ts'

export function readExtensionObservations(db: Db, serverId: string) {
  return extensionObservations(db, serverId)
}
