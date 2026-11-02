import type { OsSelector } from '@smp/console-server-management/contracts'

export const APT_SOFTWARE_OS: readonly OsSelector[] = [
  ...['22.04', '24.04'].map((version) => ({
    family: 'builtin/ubuntu',
    versions: { kind: 'release' as const, version },
    architectures: ['x86_64', 'aarch64'],
  })),
  ...['12', '13'].map((prefix) => ({
    family: 'builtin/debian',
    versions: { kind: 'series' as const, prefix },
    architectures: ['x86_64', 'aarch64'],
  })),
]
