export interface ServerPatch {
  name?: string
  host?: string
  ssh_port?: number
  ssh_user?: string
  region?: string
  type_key?: string
  type_snapshot?: string
  type_revision?: string
  install_required_software?: boolean
  declared_os?: string
  group_id?: string | null
  auth_method?: string
  ssh_key_id?: string | null
  secret_ciphertext?: string | null
  config_revision?: string | number
}

export interface ServerScope {
  id: string | null
  allGroups: boolean
  groupId: string | null
}

export interface InsertServerInput {
  id: string
  name: string
  host: string
  port: number
  user: string
  method: string
  ciphertext: string | null
  keyId: string | null
  groupId: string | null
  region: string
  auto: boolean
  os: string
  typeKey: string
  typeSnapshot: string
  typeRevision: string
}
