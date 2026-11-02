import { osVerification } from '../../shared/operating-systems.ts'
import { type Db } from '../database/connection.ts'
import { parseSample } from '../remote/parse.ts'
import { connectSsh, type SshSession } from '../remote/ssh.ts'
import { serverSecret } from './persistence/credential-repository.ts'
import { saveMetrics, serverIds } from './persistence/metrics-repository.ts'
import { cleanupMetrics, recordMetric, rollup1h, rollup5m } from './persistence/history-repository.ts'
import { claimAutoRetry, releaseAutoRetry } from './persistence/auto-retry-repository.ts'

const SAMPLE = `cores=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo)
read_cpu() { awk '/^cpu /{idle=$5+$6; t=0; for(i=2;i<=NF;i++) t+=$i; print t, idle}' /proc/stat; }
a=$(read_cpu)
sleep 1
b=$(read_cpu)
mem_total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
disk_total=$(df -B1 -P / | awk 'NR==2 {print $2}')
disk_used=$(df -B1 -P / | awk 'NR==2 {print $3}')
cpu_model=$(awk -F': ' '/^model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null || true)
printf '%s %s %s %s %s %s %s\\n' "$cores" "$a" "$b" "$mem_total" "$mem_avail" "$disk_total" "$disk_used"
printf '%s\\n' "$cpu_model"
`

const RETRY_MS = 3000

interface Secrets {
  decrypt(ciphertext: string): string
}

/** One SSH per server. A dropped connection waits a few seconds and does not mark the server offline. */
export function startMetrics(
  db: Db,
  secrets: Secrets,
  intervalSeconds: number,
  onError: (cause: unknown) => void,
  connect: typeof connectSsh = connectSsh,
  enqueueTest?: (serverId: string) => Promise<unknown>,
): () => Promise<void> {
  const sessions = new Map<string, SshSession>()
  const revisions = new Map<string, string>()
  const retryAt = new Map<string, number>()
  const busy = new Set<string>()
  const tasks = new Set<Promise<void>>()
  let stopped = false
  let lastRollup5m = 0
  let lastRollup1h = 0
  let lastCleanup = Date.now()
  const timer = setInterval(
    () => {
      const task = sampleAll()
        .catch((cause: unknown) => {
          onError(cause)
        })
        .finally(() => {
          tasks.delete(task)
        })
      tasks.add(task)
    },
    Math.max(1, intervalSeconds) * 1000,
  )

  const maintenance = setInterval(() => {
    void maintain()
  }, 60_000)
  void maintain()

  async function maintain(): Promise<void> {
    if (stopped) return
    const now = Date.now()
    try {
      if (lastRollup5m === 0 || now - lastRollup5m >= 5 * 60_000) {
        await rollup5m(db, lastRollup5m === 0 ? 7 * 24 * 3600 : 2 * 3600)
        lastRollup5m = now
      }
      if (lastRollup1h === 0 || now - lastRollup1h >= 60 * 60_000) {
        await rollup1h(db, lastRollup1h === 0 ? 30 * 24 * 3600 : 2 * 24 * 3600)
        lastRollup1h = now
      }
      if (now - lastCleanup >= 24 * 60 * 60_000) {
        await cleanupMetrics(db)
        lastCleanup = now
      }
    } catch (cause) {
      onError(cause)
    }
  }

  return async () => {
    stopped = true
    clearInterval(timer)
    clearInterval(maintenance)
    for (const session of sessions.values()) session.close()
    sessions.clear()
    await Promise.all(tasks)
  }

  async function sampleAll(): Promise<void> {
    if (stopped) return
    const ids = await serverIds(db)
    if (stopped) return
    const live = new Set(ids)
    for (const [id, session] of sessions) {
      if (live.has(id)) continue
      session.close()
      sessions.delete(id)
      revisions.delete(id)
      retryAt.delete(id)
    }
    await Promise.all(ids.map((id) => sampleOne(id)))
  }

  async function sampleOne(id: string): Promise<void> {
    if (stopped || busy.has(id) || Date.now() < (retryAt.get(id) ?? 0)) return
    busy.add(id)
    let session = sessions.get(id)
    try {
      const server = await serverSecret(db, id)
      if (stopped) return
      if (
        !server ||
        server.detected_os?.family === 'builtin/windows-server' ||
        String(server.observed_config_revision) !== String(server.config_revision) ||
        !['matched', 'custom'].includes(osVerification(server.declared_os, server.detected_os, server.os_probe_state))
      ) {
        session?.close()
        sessions.delete(id)
        revisions.delete(id)
        return
      }
      const revision = `${server.config_revision}/${server.environment_revision}`
      if (session !== undefined && revisions.get(id) !== revision) {
        session.close()
        sessions.delete(id)
        session = undefined
      }
      if (session === undefined) {
        session = await connect({
          host: server.host,
          port: server.ssh_port,
          username: server.ssh_user,
          authMethod: server.auth_method,
          secret: secrets.decrypt(server.secret_ciphertext),
          expectedFingerprint: server.host_fingerprint,
        })
        if (stopped) {
          session.close()
          return
        }
        sessions.set(id, session)
        revisions.set(id, revision)
      }
      const result = await session.exec(SAMPLE, 8000)
      if (stopped) return
      if (result.code !== 0) throw new Error(result.stderr || result.stdout || '采集失败')
      const sample = parseSample(result.stdout)
      await saveMetrics(db, id, sample, server.config_revision)
      try {
        await recordMetric(db, id, sample)
        if (enqueueTest !== undefined && await claimAutoRetry(db, id)) {
          try {
            await enqueueTest(id)
          } catch (cause) {
            await releaseAutoRetry(db, id)
            onError(cause)
          }
        }
      } catch (cause) {
        onError(cause)
      }
    } catch (cause) {
      void cause
      session?.close()
      if (sessions.get(id) === session) sessions.delete(id)
      retryAt.set(id, Date.now() + RETRY_MS)
    } finally {
      busy.delete(id)
    }
  }
}
