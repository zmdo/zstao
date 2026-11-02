import type { DeclaredOs, DetectedOs } from '../../shared/operating-systems.ts'
import { type SshSession } from './ssh.ts'

export type OsProbe = { state: 'detected'; os: DetectedOs } | { state: 'failed'; code: 'os_probe_failed' }
export const LINUX_PROBE = "cat /etc/os-release && printf '\\nSMP_ARCH=' && uname -m"
const WINDOWS_SCRIPT =
  "$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{caption=$os.Caption; architecture=$os.OSArchitecture}|ConvertTo-Json -Compress"
export const WINDOWS_PROBE = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')}`

export function parseLinuxOs(output: string): DetectedOs | null {
  if (output.length > 16_384) return null
  const values = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = /^(ID|VERSION_ID|SMP_ARCH)=(.*)$/.exec(line.trim())
    if (!match) continue
    const raw = match[2]!
    values.set(match[1]!, /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw)
  }
  const id = values.get('ID'),
    version = values.get('VERSION_ID'),
    architecture = values.get('SMP_ARCH')
  if (
    !id ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(id) ||
    !version ||
    !/^\d+(?:\.\d+)*$/.test(version) ||
    !architecture ||
    !/^[a-zA-Z0-9_-]+$/.test(architecture)
  )
    return null
  return { family: `builtin/${id}`, version, architecture }
}

export function parseWindowsOs(output: string): DetectedOs | null {
  if (output.length > 16_384) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(output.replace(/^\uFEFF/, '').trim())
  } catch (_cause) {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const value = parsed as Record<string, unknown>
  if (typeof value.caption !== 'string') return null
  const version = /Windows Server\s+(2016|2019|2022|2025)(?:\s|$)/i.exec(value.caption)?.[1]
  const architecture = value.architecture === '64-bit' || value.architecture === '64 位' ? 'x86_64' : null
  return version && architecture ? { family: 'builtin/windows-server', version, architecture } : null
}

export async function probeOs(session: SshSession, declared?: DeclaredOs): Promise<OsProbe> {
  const windows = declared?.kind === 'catalog' && declared.family === 'builtin/windows-server'
  const probes = windows
    ? [[WINDOWS_PROBE, parseWindowsOs] as const]
    : [[LINUX_PROBE, parseLinuxOs] as const, [WINDOWS_PROBE, parseWindowsOs] as const]
  for (const [command, parse] of probes) {
    let result
    try {
      result = await session.exec(command, 15_000)
    } catch (_cause) {
      continue
    }
    if (result.code !== 0) continue
    const os = parse(result.stdout)
    if (os !== null) return { state: 'detected', os }
  }
  return { state: 'failed', code: 'os_probe_failed' }
}
