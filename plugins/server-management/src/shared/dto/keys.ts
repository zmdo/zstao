export interface KeyDto {
  id: string
  name: string
  fingerprint: string
}

export interface CreatedKeyDto extends KeyDto {
  created_at: string
}

export interface KeyListDto extends CreatedKeyDto {
  server_count: number
}
