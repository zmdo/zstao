export interface TaskQuery {
  serverId: string
  query: string
  action: string
  status: string
  from: string | null
  to: string | null
  page: number
  pageSize: number
}
