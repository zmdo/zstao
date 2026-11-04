export const API = '/console-api/project-management'
export const CODE_PAGE = 'project-code-repositories'
export const PREVIEW_BYTES = 200 * 1024
export const PREVIEW_LINES = 5000
export const DOWNLOAD_BYTES = 4 * 1024 * 1024
export const COMMIT_LIMIT = 100
export const DIRECTORY_LIMIT = 2000

export interface Project {
  id: number
  name: string
  path: string
  description: string
  codeManagement: boolean
  issueManagement: boolean
  packManagement: boolean
  webUrl: string
  createDate: string
}
export interface Repository {
  project: Project
  defaultBranch: string | null
  branches: string[]
  tags: string[]
  cloneUrl: string
}
export interface TreeEntry { path: string; isFile: boolean }
export interface Tree { entries: TreeEntry[]; truncated: boolean }
export interface FilePreview {
  path: string
  size: number
  content: string
  binary: boolean
  truncated: boolean
  upstreamPartial: boolean
  highlight: boolean
  downloadable: boolean
}
export interface Commit { sha: string; subject: string; author: string; date: string }
export interface CommitList { commits: Commit[]; hasMore: boolean }
export type RefType = 'branch' | 'tag'
