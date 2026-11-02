import { type LocalizedText } from '../../shared/contracts/common.ts'
import type { DefinitionBundle } from '../../shared/contracts/definitions.ts'
import { ServerError } from '../../shared/errors.ts'
import { validateOsSupport } from '../../shared/operating-systems.ts'
import { digest } from '../recipes/canonical.ts'
import { loadScript } from '../recipes/script.ts'
import { type Component, type LoadedRecipe } from './catalog.ts'
import type { Owner } from './model.ts'
import { adapterOf } from './views.ts'

const KEY = /^[a-z][a-z0-9-]{0,63}$/
const PACKAGE = /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/
const DEFINITION_KEYS = new Set([
  'contractVersion',
  'owner',
  'operatingSystems',
  'software',
  'recipes',
  'types',
  'publicTypes',
  'groups',
])
export async function prepareOwner(
  input: DefinitionBundle,
  identity: object,
  registered: boolean,
): Promise<Owner> {
  if (input.contractVersion !== 2 || !PACKAGE.test(input.owner) || input.owner === 'builtin')
    throw new ServerError('group_definition_invalid')
  for (const key of Object.keys(input))
    if (!DEFINITION_KEYS.has(key)) throw new ServerError('definition_unsupported', { field: key })
  if (registered) throw new ServerError('group_registration_exists')
  // Custom OS identities need their own probe lifecycle. Reject unsupported capabilities instead of publishing unusable definitions.
  if (input.operatingSystems?.length)
    throw new ServerError('definition_unsupported', { field: 'operatingSystems' })
  const owner: Owner = {
    owner: input.owner,
    identity,
    active: true,
    software: new Map(),
    recipes: new Map(),
    types: new Map(),
    publicTypes: new Map(),
    groups: new Map(),
    dependencies: new Set(),
    leases: new Set(),
    drained: new Set(),
  }
  const qualify = (key: string) => {
    if (!KEY.test(key)) throw new ServerError('group_definition_invalid')
    return `${input.owner}/${key}`
  }
  for (const software of input.software ?? []) {
    const key = qualify(software.key)
    validateText(software.name)
    if (owner.software.has(key)) throw new ServerError('component_registration_conflict', { component: key })
    owner.software.set(key, { ...software, key })
    adapterOf(software).validate({ kind: 'any' })
  }
  for (const recipe of input.recipes ?? []) {
    const key = qualify(recipe.key)
    if (owner.recipes.has(key)) throw new ServerError('component_registration_conflict', { component: key })
    validateOsSupport({ kind: 'explicit', selectors: recipe.supportedOs }, true)
    if (recipe.mutation && (!recipe.listCandidates || !recipe.resolve || !recipe.mutation.actions.length))
      throw new ServerError('recipe_unavailable')
    const scripts: Component['scripts'] = { detect: await loadScript(recipe.detect) }
    if (recipe.listCandidates) scripts.listCandidates = await loadScript(recipe.listCandidates)
    if (recipe.resolve) scripts.resolve = await loadScript(recipe.resolve)
    if (recipe.mutation) {
      scripts.execute = await loadScript(recipe.mutation.execute)
      scripts.verify = await loadScript(recipe.mutation.verify)
      scripts.recover = await loadScript(recipe.mutation.recover)
    }
    if (Object.values(scripts).some((script) => script.interpreter !== 'posix-sh'))
      throw new ServerError('definition_unsupported', { field: 'powershell mutation/detection recipes' })
    const loaded: LoadedRecipe = {
      key,
      software: recipe.software,
      supportedOs: recipe.supportedOs,
      requires: recipe.requires,
      scripts,
      actions: recipe.mutation?.actions ?? [],
      revision: digest({
        key,
        software: recipe.software,
        supportedOs: recipe.supportedOs,
        requires: recipe.requires,
        scripts,
        actions: recipe.mutation?.actions ?? [],
      }),
    }
    owner.recipes.set(key, loaded)
  }
  for (const type of input.types ?? []) {
    const key = qualify(type.key)
    if (owner.types.has(key)) throw new ServerError('type_definition_conflict', { type: key })
    validateText(type.name)
    validateOsSupport(type.supportedOs, type.requirements.length > 0)
    owner.types.set(key, { ...type, key })
  }
  for (const item of input.publicTypes ?? []) {
    if (!owner.types.has(item.type)) throw new ServerError('definition_reference', { detail: item.type })
    if (item.order !== undefined && !Number.isSafeInteger(item.order))
      throw new ServerError('group_definition_invalid')
    if (owner.publicTypes.has(item.type))
      throw new ServerError('type_definition_conflict', { type: item.type })
    owner.publicTypes.set(item.type, item.order ?? 0)
  }
  for (const group of input.groups ?? []) {
    qualify(group.key)
    validateText(group.name)
    if (owner.groups.has(group.key) || group.types?.length === 0)
      throw new ServerError('group_definition_invalid')
    if (group.order !== undefined && !Number.isSafeInteger(group.order))
      throw new ServerError('group_definition_invalid')
    owner.groups.set(group.key, group)
  }

  return owner
}
function validateText(text: LocalizedText): void {
  if (!text.zh.trim() || !text.en.trim() || text.zh.length > 80 || text.en.length > 80)
    throw new ServerError('group_definition_invalid')
}
export function snapshotBundle(input: DefinitionBundle) {
  return {
    ...structuredClone({ ...input, software: undefined }),
    software: input.software?.map((s) => ({
      ...s,
      name: { ...s.name },
      versions: typeof s.versions === 'string' ? s.versions : Object.freeze({ ...s.versions }),
    })),
  }
}
