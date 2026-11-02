import { type ServerDisplayStatus } from '../../shared/server-status.ts'

export interface ServerListQuery {
  groupId: string | null
  query: string
  status: ServerDisplayStatus | ''
  order: 'name' | 'last_checked'
  page: number
  pageSize: number
  needsUpgrade?: boolean
}
