export interface SessionRemoval {
  archived(id: string): boolean
  running(id: string): boolean
  live(id: string): boolean
  /** Tear down the in-memory agent. Returns false when that teardown cannot be found. */
  release(id: string): Promise<boolean>
  detach(id: string): Promise<void>
  unarchive(id: string): Promise<void>
  erase(id: string): Promise<void>
}

export type RemovalResult = { ok: true } | { ok: false; status: number; detail: string }

/**
 * Drop an archived session. The log is erased before the archive flag, so a
 * failed follow-up can be retried while the session is still archived.
 */
export async function removeArchivedSession(removal: SessionRemoval, id: string): Promise<RemovalResult> {
  if (!removal.archived(id)) return { ok: false, status: 400, detail: '先归档再删除' }
  if (removal.running(id)) return { ok: false, status: 409, detail: '会话还在跑' }
  if (removal.live(id)) {
    const released = await removal.release(id)
    if (!released || removal.live(id)) return { ok: false, status: 500, detail: '会话没有卸下来' }
  }
  try {
    await removal.erase(id)
  } catch (cause) {
    void cause
    return { ok: false, status: 500, detail: '没有删掉' }
  }
  try {
    await removal.detach(id)
  } catch (cause) {
    void cause
    return { ok: false, status: 500, detail: '工作区没有摘掉' }
  }
  try {
    await removal.unarchive(id)
  } catch (cause) {
    void cause
    return { ok: false, status: 500, detail: '归档标记还在' }
  }
  return { ok: true }
}
