import { mkdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DEFAULT_WORKSPACE_TITLE } from './rules.ts'

/** A group directory is a relative path under the account home. `~` and absolute paths are rejected. */
export function resolveGroupDirectory(home: string, directory: string): string {
  const trimmed = directory.trim()
  if (trimmed === '' || trimmed.includes('\0')) throw new Error('绑定目录不能为空')
  if (trimmed.startsWith('~') || isAbsolute(trimmed)) throw new Error('绑定目录必须位于主目录下')
  const absolute = resolve(home, trimmed)
  const fromHome = relative(home, absolute)
  if (fromHome === '..' || fromHome.startsWith(`..${sep}`) || isAbsolute(fromHome)) throw new Error('绑定目录必须位于主目录下')
  return absolute
}

export function defaultWorkspacePath(bound: string): string {
  return join(bound, DEFAULT_WORKSPACE_TITLE)
}

/** Create the directory. A file anywhere along the path is an error, not something to write through. */
export async function ensureDirectory(absolute: string): Promise<void> {
  let current = absolute
  for (;;) {
    try {
      const info = await stat(current)
      if (!info.isDirectory()) throw new Error('绑定目录的某一段已经是文件')
      break
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code === 'ENOTDIR') throw new Error('绑定目录的某一段已经是文件')
      if (code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw new Error('绑定目录的某一段已经是文件')
      current = parent
    }
  }
  await mkdir(absolute, { recursive: true })
}
