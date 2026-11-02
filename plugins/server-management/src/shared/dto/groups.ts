import type { LocalizedText, TypeOptions } from '../definitions.ts'

export interface GroupView extends TypeOptions {
  id: string
  name: string
  plugin_id: string | null
  group_key: string | null
  name_i18n: LocalizedText | null
  sort_order: number
  definition: Partial<TypeOptions>
  server_count?: number
}

export interface GroupDto extends GroupView {
  server_count: number
}
