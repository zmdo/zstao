import type {
  ServerTypeDefinition,
  SoftwareDefinition,
  SystemGroupDefinition,
} from '../../shared/contracts/definitions.ts'
import { type ServerTypeView } from '../../shared/definitions.ts'
import { type Component, type LoadedRecipe } from './catalog.ts'

export interface Owner {
  identity: object
  owner: string
  active: boolean
  software: Map<string, SoftwareDefinition>
  recipes: Map<string, LoadedRecipe>
  types: Map<string, ServerTypeDefinition>
  publicTypes: Map<string, number>
  groups: Map<string, SystemGroupDefinition>
  dependencies: Set<Owner>
  leases: Set<symbol>
  drained: Set<() => void>
  closing?: Promise<void>
}

export interface TypeLease {
  type: ServerTypeView
  components: readonly Component[]
  signature: string
  release(): void
}
