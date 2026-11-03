export interface Copy {
  groupTitle: string
  filesTitle: string
  auditTitle: string
  settingsTitle: string
  platformTitle: string
  refresh: string
  upload: string
  uploadHint: string
  openSidebar: string
  sidebarHint: string
  sidebarNoSession: string
  sidebarTitle: string
  loadMore: string
  searchPlaceholder: string
  empty: string
  loading: string
  loadFailed: string
  root: string
  download: string
  delete: string
  confirmDelete: string
  uploadFailed: string
  tooLarge: string
  previous: string
  next: string
  pageOf: string
  perPage: string
  items: string
  total: string
  previewLoading: string
  previewFailed: string
  unsupportedTitle: string
  unsupportedBody: string
  close: string
  truncated: string
  folders: string
  files: string
  size: string
  updated: string
  name: string
  attachmentsTitle: string
  defaultTitle: string
  attachmentsHint: string
  bucket: string
  region: string
  secretId: string
  secretKey: string
  secretKeyHint: string
  basePrefix: string
  maxUpload: string
  maxPreview: string
  test: string
  testOk: string
  save: string
  saved: string
  saving: string
  saveFailed: string
  requiredBoth: string
  time: string
  actor: string
  action: string
  object: string
  status: string
  keyFilter: string
  allActions: string
  allTime: string
  last24h: string
  last7d: string
  last30d: string
  actionConfig: string
  actionUpload: string
  actionDownload: string
  actionDelete: string
  succeeded: string
  failed: string
  error: string
  detail: string
  currentAction: string
}

const ZH: Copy = {
  groupTitle: '网络文件管理',
  filesTitle: '文件管理',
  auditTitle: '审计记录',
  settingsTitle: '对象存储',
  platformTitle: '平台设置',
  refresh: '刷新',
  upload: '上传',
  uploadHint: '拖入文件或点击上传',
  openSidebar: '在侧边栏打开',
  sidebarHint: '浏览 COS 默认桶，点击文件用内置预览打开',
  sidebarNoSession: '请先打开一个会话',
  sidebarTitle: '网络文件管理',
  loadMore: '加载更多',
  searchPlaceholder: '在当前前缀内搜索',
  empty: '这里还没有文件。',
  loading: '加载中…',
  loadFailed: '加载失败',
  root: '根目录',
  download: '下载',
  delete: '删除',
  confirmDelete: '确认删除这个对象？不会递归删除前缀。',
  uploadFailed: '上传失败',
  tooLarge: '文件超过上传上限',
  previous: '上一页',
  next: '下一页',
  pageOf: '第 {page} 页',
  perPage: '每页',
  items: '项',
  total: '共 {count} 项',
  previewLoading: '加载预览…',
  previewFailed: '预览加载失败',
  unsupportedTitle: '无法打开',
  unsupportedBody: '这个文件类型不支持在线预览，请下载后查看。',
  close: '关闭',
  truncated: '结果已截断，请缩小前缀或搜索范围',
  folders: '目录',
  files: '文件',
  size: '大小',
  updated: '修改时间',
  name: '名称',
  attachmentsTitle: 'Harness 数据桶',
  defaultTitle: '默认桶',
  attachmentsHint: '仅用于 Harness 会话附件（图片、文件），不在文件管理里显示，也不提供给 AI 工具。',
  bucket: 'Bucket',
  region: 'Region',
  secretId: 'SecretId',
  secretKey: 'SecretKey',
  secretKeyHint: '留空表示保持原值',
  basePrefix: '根前缀',
  maxUpload: '上传上限（MB）',
  maxPreview: '预览上限（MB）',
  test: '测试连接',
  testOk: '连接正常',
  save: '保存',
  saved: '已保存',
  saving: '保存中…',
  saveFailed: '保存失败',
  requiredBoth: '两个桶都必须配置',
  time: '时间',
  actor: '来源',
  action: '操作',
  object: '对象',
  status: '状态',
  keyFilter: '按对象名筛选',
  allActions: '全部操作',
  allTime: '全部时间',
  last24h: '最近 24 小时',
  last7d: '最近 7 天',
  last30d: '最近 30 天',
  actionConfig: '配置',
  actionUpload: '上传',
  actionDownload: '下载',
  actionDelete: '删除',
  succeeded: '成功',
  failed: '失败',
  error: '错误',
  detail: '详情',
  currentAction: '操作',
}

const EN: Copy = {
  groupTitle: 'Network files',
  filesTitle: 'Files',
  auditTitle: 'Audit log',
  settingsTitle: 'Object storage',
  platformTitle: 'Platform settings',
  refresh: 'Refresh',
  upload: 'Upload',
  uploadHint: 'Drop files or click to upload',
  openSidebar: 'Open in sidebar',
  sidebarHint: 'Browse the default COS bucket and open files with the built-in preview',
  sidebarNoSession: 'Open a conversation first',
  sidebarTitle: 'Network files',
  loadMore: 'Load more',
  searchPlaceholder: 'Search in the current prefix',
  empty: 'No files here yet.',
  loading: 'Loading…',
  loadFailed: 'Failed to load',
  root: 'Root',
  download: 'Download',
  delete: 'Delete',
  confirmDelete: 'Delete this object? Prefixes are not deleted recursively.',
  uploadFailed: 'Upload failed',
  tooLarge: 'File exceeds the upload limit',
  previous: 'Previous',
  next: 'Next',
  pageOf: 'Page {page}',
  perPage: 'Per page',
  items: 'items',
  total: '{count} items',
  previewLoading: 'Loading preview…',
  previewFailed: 'Failed to load preview',
  unsupportedTitle: 'Cannot open',
  unsupportedBody: 'This file type cannot be previewed. Download it to open it.',
  close: 'Close',
  truncated: 'Results truncated; narrow the prefix or search',
  folders: 'Folders',
  files: 'Files',
  size: 'Size',
  updated: 'Updated',
  name: 'Name',
  attachmentsTitle: 'Harness data bucket',
  defaultTitle: 'Default bucket',
  attachmentsHint: 'Only for Harness session attachments (images and files). Hidden from the file page and from AI tools.',
  bucket: 'Bucket',
  region: 'Region',
  secretId: 'SecretId',
  secretKey: 'SecretKey',
  secretKeyHint: 'Leave blank to keep the current value',
  basePrefix: 'Base prefix',
  maxUpload: 'Upload limit (MB)',
  maxPreview: 'Preview limit (MB)',
  test: 'Test connection',
  testOk: 'Connection OK',
  save: 'Save',
  saved: 'Saved',
  saving: 'Saving…',
  saveFailed: 'Failed to save',
  requiredBoth: 'Both buckets are required',
  time: 'Time',
  actor: 'Actor',
  action: 'Action',
  object: 'Object',
  status: 'Status',
  keyFilter: 'Filter by object key',
  allActions: 'All actions',
  allTime: 'All time',
  last24h: 'Last 24 hours',
  last7d: 'Last 7 days',
  last30d: 'Last 30 days',
  actionConfig: 'Config',
  actionUpload: 'Upload',
  actionDownload: 'Download',
  actionDelete: 'Delete',
  succeeded: 'OK',
  failed: 'Failed',
  error: 'Error',
  detail: 'Details',
  currentAction: 'Action',
}

export function copyFor(locale: string): Copy {
  return locale === 'en' ? EN : ZH
}
