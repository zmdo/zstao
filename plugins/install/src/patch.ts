import { isMap, isSeq, parseDocument, Scalar, visit, type Document } from 'yaml'

export const STORE_ID = 'smp-database'
export const INSTALL_ID = 'smp-install'

const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => value,
}

export interface StoreCredentials {
  databaseUrl: string
  encryptionKey: string
}

/** The store row's URL and key, when both are non-empty strings. */
export function storeCredentials(source: string): StoreCredentials | undefined {
  const row = rowData(source, STORE_ID)
  const config = record(row?.config)
  const databaseUrl = config?.databaseUrl
  const encryptionKey = config?.encryptionKey
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') return undefined
  if (typeof encryptionKey !== 'string' || encryptionKey.trim() === '') return undefined
  return { databaseUrl, encryptionKey }
}

/** Whether the profile patch already disables the install plugin. */
export function installDisabled(source: string): boolean {
  return rowData(source, INSTALL_ID)?.disabled === true
}

/** Remove the two store fields. Other rows and other store fields stay. */
export function clearStoreCredentials(source: string): string {
  return edit(source, (document) => {
    const index = rowIndex(document, STORE_ID)
    if (index < 0) return
    document.deleteIn([index, 'config', 'databaseUrl'])
    document.deleteIn([index, 'config', 'encryptionKey'])
  })
}

/** Drop the install plugin's disabled override so a fresh profile loads it. */
export function clearInstallDisabled(source: string): string {
  return edit(source, (document) => {
    const index = rowIndex(document, INSTALL_ID)
    if (index < 0) return
    const row = document.get(index)
    if (!isMap(row)) return
    row.delete('disabled')
    if (row.items.length === Number(row.has('id')) + Number(row.has('name'))) document.delete(index)
  })
}

/** Write the store credentials, the disable flag, or both. */
export function writeInstallPatch(source: string, change: {
  credentials?: StoreCredentials
  disable?: boolean
}): string {
  return edit(source, (document) => {
    if (change.credentials !== undefined) setCredentials(document, change.credentials)
    if (change.disable === true) setDisabled(document)
  })
}

function setCredentials(document: Document, credentials: StoreCredentials): void {
  const index = rowIndex(document, STORE_ID)
  if (index < 0) {
    document.add(document.createNode({
      id: STORE_ID,
      config: {
        databaseUrl: credentials.databaseUrl,
        encryptionKey: credentials.encryptionKey,
      },
    }))
    return
  }
  if (document.getIn([index, 'config']) == null) {
    document.setIn([index, 'config'], document.createNode({}))
  }
  document.setIn([index, 'config', 'databaseUrl'], credentials.databaseUrl)
  document.setIn([index, 'config', 'encryptionKey'], credentials.encryptionKey)
}

function setDisabled(document: Document): void {
  const index = rowIndex(document, INSTALL_ID)
  if (index < 0) {
    document.add(document.createNode({ id: INSTALL_ID, disabled: true }))
    return
  }
  document.setIn([index, 'disabled'], true)
}

function edit(source: string, change: (document: Document) => void): string {
  const document = parse(source)
  change(document)
  restoreJsTags(document)
  return String(document)
}

function rowData(source: string, id: string): Record<string, unknown> | undefined {
  const document = parse(source)
  const index = rowIndex(document, id)
  if (index < 0) return undefined
  const value = document.toJS()
  const row = Array.isArray(value) ? value[index] : undefined
  return record(row)
}

function rowIndex(document: Document, id: string): number {
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  return document.contents.items.findLastIndex((item, index) => {
    return isMap(item) && document.getIn([index, 'id']) === id && !item.has('insert')
  })
}

function parse(source: string): Document {
  const document = parseDocument(source.trim() === '' ? '[]\n' : source, { customTags: [jsTag] })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  return document
}

/** `yaml` parses `!!js` into a one-key map. Write it back as a tagged scalar. */
function restoreJsTags(document: Document): void {
  visit(document, {
    Map(_key, node) {
      if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return undefined
      const expression = new Scalar(node.get('__jsExpr'))
      expression.tag = 'tag:yaml.org,2002:js'
      return expression
    },
  })
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
