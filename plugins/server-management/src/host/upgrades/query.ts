export interface SuggestionQuery {
  page: number
  query: string
  decision: string
  group: string | null
  type: string | null
  software: string | null
  connection: string | null
  current: string | null
  target: string | null
  server: string | null
}
