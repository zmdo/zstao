import { randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

export async function readPatch(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

/** Replace the profile patch without logging its contents. */
export async function writePatch(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, contents.endsWith('\n') ? contents : `${contents}\n`, { mode: 0o600 })
  await rename(temporary, path)
}
