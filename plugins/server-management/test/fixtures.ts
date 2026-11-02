import { APT_SOFTWARE_OS } from '../src/shared/operating-systems.ts'
import {type Component} from '../src/host/definitions/catalog.ts'
import {builtinCatalog as productionCatalog} from '../src/host/definitions/catalog.ts'
import { stableVersions } from '../src/shared/versions.ts'

export function componentFixture(id: string, requires: string[] = []): Component {
  return {
    id,
    software_key: `test/${id}`,
    supportedOs: APT_SOFTWARE_OS,
    name: id,
    summary: '',
    requires,
    recipe: `test/${id}`,
    revision: `revision-${id}`,
    name_i18n: { zh: id, en: id },
    summary_i18n: { zh: '', en: '' },
    versions: { kind: 'any' },
    adapter: stableVersions,
    actions: ['install'],
    scripts: Object.fromEntries(
      ['detect', 'listCandidates', 'resolve', 'execute', 'verify', 'recover'].map((operation) => [
        operation,
        { interpreter: 'posix-sh', body: operation, timeoutMs: 1000, outputLimitBytes: 4096 },
      ]),
    ) as Component['scripts'],
  }
}
export function builtinCatalog(): Component[] {
  return productionCatalog()
}
