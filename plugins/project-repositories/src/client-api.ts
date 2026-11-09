import { useSyncExternalStore } from 'react'
import { API } from './shared.ts'
export interface LocaleFace { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
export function useLanguage(locale: LocaleFace): boolean {
  return useSyncExternalStore(callback => locale.subscribe(callback), () => locale.getSnapshot().active) !== 'en'
}
export class RequestError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}
export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path.startsWith(API) ? path : `${API}${path}`, { credentials: 'same-origin', ...init })
  const body = await response.json()
  if (!response.ok) throw new RequestError(typeof body.code === 'string' ? body.code : 'request_failed')
  return body as T
}
const errors: Record<string, [string, string]> = {
  pull_credential_changed: ['配置已被更新，请重新读取后再保存。', 'Settings changed. Reload before saving.'],
  pull_credential_incomplete: ['请填写拉取账号、密码和允许的仓库范围。', 'Enter a pull username, password and repository scopes.'],
  invalid_pull_credential: ['拉取凭据格式不正确，请检查输入。', 'Check the pull credential fields.'],
  invalid_repository_scope: ['仓库范围格式不正确，请使用 namespace/repository 或 namespace/*。', 'Use namespace/repository or namespace/*.'],
  image_scope_denied: ['仓库不在拉取凭据允许的范围内。', 'The repository is outside the allowed credential scope.'],
  application_server_required: ['请选择应用服务器。', 'Select an application server.'],
  auth_required: ['登录已失效，请重新登录。', 'Please sign in again.'],
  not_configured: ['请先到项目管理配置 OneDev。', 'Configure OneDev in Project management first.'],
  credentials_unavailable: ['无法读取凭据，请重新保存 OneDev 密码。', 'Save the OneDev password again.'],
  upstream_credentials: ['OneDev 凭据无效，请重新保存密码。', 'The OneDev credentials are invalid.'],
  upstream_forbidden: ['OneDev 账户无权访问此资源。', 'The OneDev account cannot access this resource.'],
  upstream_unavailable: ['无法连接 OneDev，请检查项目管理中的地址。', 'Cannot reach OneDev. Check the configured URL.'],
  upstream_timeout: ['OneDev 请求超时，请重试。', 'OneDev timed out. Please retry.'],
  not_found: ['此项目、引用或路径不存在。', 'This project, reference or path does not exist.'],
  unsupported_entry: ['此路径不是可读取的普通文件或目录。', 'This path is not a supported file or directory.'],
  code_disabled: ['此项目未开启代码管理。', 'Code management is disabled for this project.'],
  response_too_large: ['内容超过读取上限，请在 OneDev 中查看。', 'The response is too large. Open OneDev to view it.'],
  download_too_large: ['文件过大或上游仅返回部分内容，请通过 OneDev 下载。', 'The file is too large or incomplete. Download it from OneDev.'],
  invalid_upstream: ['OneDev 返回的数据格式不受支持。', 'OneDev returned an unsupported response.'],
  rate_limited: ['操作过于频繁，请稍后重试。', 'Too many requests. Please try again later.'],
  invalid_url: ['请填写不含凭据、查询参数或片段的 HTTP/HTTPS 地址。', 'Enter an HTTP/HTTPS URL without credentials, query or fragment.'],
  invalid_username: ['请填写有效的 OneDev 用户名。', 'Enter a valid OneDev username.'],
  password_required: ['首次配置必须填写密码。', 'A password is required for initial setup.'],
  settings_unavailable: ['无法读取项目配置。', 'Project settings could not be read.'],
  invalid_path: ['仓库路径无效。', 'Invalid repository path.'],
  invalid_revision: ['仓库引用无效。', 'Invalid repository reference.'],
  clipboard_failed: ['无法访问剪贴板，请使用 HTTPS 或手动复制显示内容。', 'Clipboard is unavailable. Use HTTPS or copy the displayed text manually.'],
}
export function errorText(cause: unknown, zh: boolean): string {
  const copy = cause instanceof RequestError ? errors[cause.code] : undefined
  return copy ? copy[zh ? 0 : 1] : zh ? '请求未完成，请重试。' : 'The request failed. Please retry.'
}
