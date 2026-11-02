export interface CreatedKeyRow {
  id: string
  name: string
  fingerprint: string
  created_at: Date
}
export interface KeyListRow extends CreatedKeyRow {
  server_count: number
}

export type SecretForConnectionRow = { secret_ciphertext: string }
