/** A key still attached to a server cannot be removed. */
export function keyInUse(serverCount: number): boolean {
  return serverCount > 0
}

/** A saved server is retested only when automatic install is on and the connection or selection changed. */
export function shouldRetest(input: {
  autoInstall: boolean
  connectionChanged: boolean
  selectionChanged: boolean
}): boolean {
  return input.autoInstall && (input.connectionChanged || input.selectionChanged)
}

export interface RetestSnap {
  autoInstall: boolean
  host: string
  port: number
  user: string
  method: string
  keyId: string | null
  selection: string
  secretWritten: boolean
}

/** Field presence is not a change. A repeated edit of the same login must not queue another test. */
export function retestAfterEdit(before: RetestSnap, after: RetestSnap): boolean {
  const connectionChanged =
    before.host !== after.host ||
    before.port !== after.port ||
    before.user !== after.user ||
    before.method !== after.method ||
    before.keyId !== after.keyId ||
    after.secretWritten
  const selectionChanged = before.autoInstall !== after.autoInstall || before.selection !== after.selection
  return shouldRetest({ autoInstall: after.autoInstall, connectionChanged, selectionChanged })
}
