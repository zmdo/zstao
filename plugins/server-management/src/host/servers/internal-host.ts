import type { SshSession } from '../remote/ssh.ts'

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/

/** Resolve the address a server uses for its private side; null when the host cannot report one. */
export async function probeInternalHost(session: SshSession): Promise<string | null> {
  for (const command of [
    "ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'",
    "hostname -I 2>/dev/null | awk '{print $1}'",
  ]) {
    const result = await session.exec(command, 5_000)
    const value = result.stdout.trim().split(/\s+/)[0] ?? ''
    if (IPV4.test(value)) return value
  }
  return null
}
