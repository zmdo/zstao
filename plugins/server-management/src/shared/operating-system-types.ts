export type OsVersionRule =
  | { readonly kind: 'any' }
  | { readonly kind: 'release'; readonly version: string }
  | { readonly kind: 'series'; readonly prefix: string }
  | { readonly kind: 'range'; readonly minimum: string; readonly maximum: string }

export interface OsSelector {
  readonly family: string
  readonly versions: OsVersionRule
  readonly architectures?: readonly string[]
}
export type OsSupport =
  | { readonly kind: 'all' }
  | { readonly kind: 'explicit'; readonly selectors: readonly OsSelector[] }

export type DeclaredOs =
  | {
      readonly kind: 'catalog'
      readonly family: string
      readonly releaseKey: string
      readonly version: string
      readonly precision: 'release' | 'series'
      readonly name: string
    }
  | { readonly kind: 'custom'; readonly text: string }

export interface DetectedOs {
  readonly family: string
  readonly version: string
  readonly architecture: string
}
export interface ProbedOs extends DetectedOs {
  readonly raw: Readonly<Record<string, string>>
}
