import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/** One whole-unit JSON document, the shape `storage-json` writes for `single` layout. */
export interface ImportedUnit {
  version: number
  global: unknown
  tables: Record<string, Record<string, unknown>>
}

/**
 * Read `<root>/<name>.json` when it belongs to this unit.
 * A missing file means there is nothing to import.
 */
export async function readUnitFile(root: string, descriptor: KvUnitDescriptor): Promise<ImportedUnit | undefined> {
  if (root === '') return undefined
  let text: string
  try {
    text = await readFile(join(root, `${descriptor.name}.json`), 'utf8')
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  return parseUnitFile(text, descriptor)
}

export function parseUnitFile(text: string, descriptor: KvUnitDescriptor): ImportedUnit {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (cause) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': import file is not JSON`, { cause })
  }
  if (!isRecord(document)) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': import file is not an object`)
  }
  const header = document.unit
  if (!isRecord(header) || header.name !== descriptor.name || typeof header.version !== 'number') {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': missing or foreign unit header`)
  }
  if (header.version !== descriptor.version) {
    throw new StorageError('version-mismatch', `unit '${descriptor.name}': stored version ${header.version} != expected ${descriptor.version}`)
  }
  const tables = document.tables
  if (!isRecord(tables)) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': tables is not an object`)
  }
  const accepted: Record<string, Record<string, unknown>> = {}
  for (const table of descriptor.tables) {
    const records = tables[table]
    if (records === undefined) {
      accepted[table] = {}
      continue
    }
    if (!isRecord(records)) {
      throw new StorageError('malformed-medium', `unit '${descriptor.name}': table '${table}' is not an object`)
    }
    accepted[table] = records
  }
  return {
    version: header.version,
    global: document.global ?? null,
    tables: accepted,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
