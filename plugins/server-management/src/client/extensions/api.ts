import { api } from '../shared/api.ts'

export interface ExtensionSettingsValue {
  value: unknown
  revision: string
}

export interface ExtensionApi {
  data(serverId: string, key: string, params?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<unknown>
  settings(serverId: string, key: string, signal?: AbortSignal): Promise<ExtensionSettingsValue>
  saveSettings(serverId: string, key: string, value: unknown, revision: string): Promise<ExtensionSettingsValue>
  planSettings(serverId: string, key: string, value: unknown, revision: string): Promise<{ id: string; digest: string; expires_at: string }>
  applySettings(serverId: string, key: string, planId: string, digest: string): Promise<ExtensionSettingsValue>
}

export const extensionApi: ExtensionApi = {
  async data(serverId, key, params = {}, signal) {
    const search = new URLSearchParams({ key, ...params })
    const result = await api<{ value: unknown }>(
      `/console-api/servers/${encodeURIComponent(serverId)}/extension-data?${search.toString()}`, { signal },
    )
    return result.value
  },
  async settings(serverId, key, signal) {
    const search = new URLSearchParams({ key })
    return api<ExtensionSettingsValue>(
      `/console-api/servers/${encodeURIComponent(serverId)}/extension-settings?${search.toString()}`, { signal },
    )
  },
  async saveSettings(serverId, key, value, revision) {
    const search = new URLSearchParams({ key })
    return api<ExtensionSettingsValue>(
      `/console-api/servers/${encodeURIComponent(serverId)}/extension-settings?${search.toString()}`,
      { method: 'PUT', body: JSON.stringify({ value, revision }) },
    )
  },
  async planSettings(serverId, key, value, revision) {
    const search = new URLSearchParams({ key })
    return api(
      `/console-api/servers/${encodeURIComponent(serverId)}/extension-settings/plan?${search.toString()}`,
      { method: 'POST', body: JSON.stringify({ value, revision }) },
    )
  },
  async applySettings(serverId, key, planId, digest) {
    const search = new URLSearchParams({ key })
    return api(
      `/console-api/servers/${encodeURIComponent(serverId)}/extension-settings/apply?${search.toString()}`,
      { method: 'POST', body: JSON.stringify({ plan_id: planId, digest }) },
    )
  },
}
