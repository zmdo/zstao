import { isMap, isSeq, parseDocument, Scalar, visit, type Document } from 'yaml'

const STORE_ID = 'smp-database'

const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => value,
}

/** The store row's encryption key, when it is a non-empty string. */
export function encryptionKey(source: string): string | undefined {
  const row = rowData(source)
  const config = record(row?.config)
  const value = config?.encryptionKey
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
}

/** Replace only the encryption key. Other rows and the database URL stay. */
export function writeEncryptionKey(source: string, nextKey: string): string | undefined {
  const document = parse(source)
  const index = rowIndex(document)
  if (index < 0) return undefined
  if (document.getIn([index, 'config']) == null) {
    document.setIn([index, 'config'], document.createNode({}))
  }
  document.setIn([index, 'config', 'encryptionKey'], nextKey)
  restoreJsTags(document)
  return String(document)
}

function rowData(source: string): Record<string, unknown> | undefined {
  const document = parse(source)
  const index = rowIndex(document)
  if (index < 0) return undefined
  const value = document.toJS()
  const row = Array.isArray(value) ? value[index] : undefined
  return record(row)
}

function rowIndex(document: Document): number {
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  return document.contents.items.findLastIndex((item, index) => {
    return isMap(item) && document.getIn([index, 'id']) === STORE_ID && !item.has('insert')
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
