import type { Candidate, SoftwareObservation } from '../../shared/contracts/recipes.ts'

export interface UpdateCheck {
  software: string
  before: SoftwareObservation
  eligible: Candidate[]
  reason: string | null
  errors: unknown[]
}
