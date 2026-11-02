import type { LocaleFace } from './api.ts'

export interface Copy {
  title: string
  groupTitle: string
  instancesTitle: string
  auditTitle: string
  domains: string
  add: string
  refresh: string
  empty: string
  loading: string
  loadFailed: string
  selectHint: string
  records: string
  type: string
  name: string
  content: string
  ttl: string
  proxied: string
  proxiedOn: string
  proxiedOff: string
  updated: string
  noRecords: string
  addTitle: string
  accountIdLabel: string
  accountIdPlaceholder: string
  domainLabel: string
  domainPlaceholder: string
  tokenLabel: string
  tokenHint: string
  cancel: string
  submit: string
  verifying: string
  errors: Record<string, string>
  account: string
  search: string
  previous: string
  next: string
  noDescription: string
  descriptionLabel: string
  descriptionPlaceholder: string
  editTitle: string
  save: string
  deleteTitle: string
  deleteHint: string
  remove: string
  edit: string
  filedLabel: string
  filedHint: string
  filedYes: string
  filedNo: string
  auditTool: string
  auditAllTools: string
  auditCreate: string
  auditUpdate: string
  auditDelete: string
  auditTimeRange: string
  auditAllTime: string
  auditLast24h: string
  auditLast7d: string
  auditLast30d: string
  auditTime: string
  auditAction: string
  auditDomain: string
  auditSummary: string
  auditStatus: string
  auditSession: string
  auditSucceeded: string
  auditFailed: string
  auditDomainFilter: string
  auditEmpty: string
  auditLoadFailed: string
  auditArgs: string
  auditDetail: string
  auditError: string
}

const ZH: Copy = {
  title: '域名管理',
  groupTitle: '域名管理',
  instancesTitle: '域名实例',
  auditTitle: '审计记录',
  domains: '域名',
  add: '添加域名',
  refresh: '刷新',
  empty: '还没有域名，点右上角添加。',
  loading: '加载中…',
  loadFailed: '加载失败',
  selectHint: '从左侧选择一个域名查看 DNS 记录。',
  records: 'DNS 记录',
  type: '类型',
  name: '名称',
  content: '内容',
  ttl: 'TTL',
  proxied: '代理',
  proxiedOn: '已代理',
  proxiedOff: '仅 DNS',
  updated: '更新时间',
  noRecords: '该域名暂无 DNS 记录。',
  addTitle: '添加域名',
  accountIdLabel: 'Cloudflare 账户 ID',
  accountIdPlaceholder: '32 位十六进制账户 ID',
  domainLabel: '域名',
  domainPlaceholder: 'example.com',
  tokenLabel: 'Cloudflare API 令牌',
  tokenHint: '需要该域名的 Zone:Read 与 DNS:Edit 权限。令牌加密后只保存在本机数据库。',
  cancel: '取消',
  submit: '验证并添加',
  verifying: '正在验证…',
  account: '账号',
  errors: {
    auth_required: '登录已过期，请重新登录。',
    invalid_domain: '域名格式不正确，例如 example.com。',
    invalid_account_id: '账户 ID 是 Cloudflare 的 32 位十六进制账户 ID。',
    invalid_token: '请填写 Cloudflare API 令牌。',
    duplicate: '这个域名已经在列表里了。',
    unauthorized: '令牌无效或已过期。',
    zone_not_found: '这个令牌看不到该域名所在的 Zone。',
    account_mismatch: '该域名不在这个 Cloudflare 账户下。',
    dns_read_forbidden: '令牌没有读取 DNS 的权限。',
    dns_write_forbidden: '令牌没有修改 DNS 的权限，请给它 DNS:Edit。',
    network: '访问 Cloudflare 失败，请检查网络后重试。',
    cloudflare: 'Cloudflare 返回了错误。',
    not_found: '域名不存在。',
    internal: '服务器内部错误。',
    request_failed: '请求失败。',
  },
  search: '搜索',
  previous: '上一页',
  next: '下一页',
  noDescription: '未填写说明',
  descriptionLabel: '域名说明',
  descriptionPlaceholder: '例如：公司主站，用于官网和邮件',
  editTitle: '修改域名',
  save: '保存',
  deleteTitle: '删除域名',
  deleteHint: '删除后这个域名不再受平台管理，Cloudflare 上的 DNS 记录不会被修改。',
  remove: '删除',
  edit: '修改',
  filedLabel: '已在中国备案（ICP）',
  filedHint: '只有备案过的域名才能用于中国大陆服务器。',
  filedYes: '已备案',
  filedNo: '未备案',
  auditTool: '操作工具',
  auditAllTools: '全部操作',
  auditCreate: '新增',
  auditUpdate: '修改',
  auditDelete: '删除',
  auditTimeRange: '时间范围',
  auditAllTime: '全部时间',
  auditLast24h: '最近 24 小时',
  auditLast7d: '最近 7 天',
  auditLast30d: '最近 30 天',
  auditTime: '时间',
  auditAction: '操作',
  auditDomain: '域名',
  auditSummary: '摘要',
  auditStatus: '状态',
  auditSession: '会话',
  auditSucceeded: '成功',
  auditFailed: '失败',
  auditDomainFilter: '按域名筛选',
  auditEmpty: '还没有 DNS 变更记录。',
  auditLoadFailed: '审计记录加载失败。',
  auditArgs: '参数',
  auditDetail: '详情',
  auditError: '错误',
}

const EN: Copy = {
  title: 'Domain manager',
  groupTitle: 'Domain manager',
  instancesTitle: 'Domains',
  auditTitle: 'Audit log',
  domains: 'Domains',
  add: 'Add domain',
  refresh: 'Refresh',
  empty: 'No domains yet. Add one from the top right.',
  loading: 'Loading…',
  loadFailed: 'Failed to load',
  selectHint: 'Pick a domain on the left to read its DNS records.',
  records: 'DNS records',
  type: 'Type',
  name: 'Name',
  content: 'Content',
  ttl: 'TTL',
  proxied: 'Proxy',
  proxiedOn: 'Proxied',
  proxiedOff: 'DNS only',
  updated: 'Updated',
  noRecords: 'This domain has no DNS records.',
  addTitle: 'Add domain',
  accountIdLabel: 'Cloudflare account ID',
  accountIdPlaceholder: '32-character hex account ID',
  domainLabel: 'Domain',
  domainPlaceholder: 'example.com',
  tokenLabel: 'Cloudflare API token',
  tokenHint: 'The token needs Zone:Read and DNS:Edit for this domain. It is encrypted and stored in the local database only.',
  cancel: 'Cancel',
  submit: 'Verify and add',
  verifying: 'Verifying…',
  account: 'Account',
  errors: {
    auth_required: 'Your session expired. Sign in again.',
    invalid_domain: 'That is not a domain. Use a name such as example.com.',
    invalid_account_id: 'The account ID is the 32-character hex ID from Cloudflare.',
    invalid_token: 'Enter a Cloudflare API token.',
    duplicate: 'This domain is already in the list.',
    unauthorized: 'The token is invalid or expired.',
    zone_not_found: 'The token cannot see the zone for this domain.',
    account_mismatch: 'That domain is not in this Cloudflare account.',
    dns_read_forbidden: 'The token cannot read DNS records.',
    dns_write_forbidden: 'The token cannot change DNS records. Grant DNS:Edit.',
    network: 'Could not reach Cloudflare. Check the network and retry.',
    cloudflare: 'Cloudflare returned an error.',
    not_found: 'The domain does not exist.',
    internal: 'Internal server error.',
    request_failed: 'The request failed.',
  },
  search: 'Search',
  previous: 'Previous',
  next: 'Next',
  noDescription: 'No description',
  descriptionLabel: 'Description',
  descriptionPlaceholder: 'For example: company site used for the website and mail',
  editTitle: 'Edit domain',
  save: 'Save',
  deleteTitle: 'Delete domain',
  deleteHint: 'The domain is removed from this platform. Its Cloudflare DNS records are not touched.',
  remove: 'Delete',
  edit: 'Edit',
  filedLabel: 'Filed in mainland China (ICP)',
  filedHint: 'Only filed domains may be used with mainland China servers.',
  filedYes: 'Filed',
  filedNo: 'Not filed',
  auditTool: 'Tool',
  auditAllTools: 'All actions',
  auditCreate: 'Create',
  auditUpdate: 'Update',
  auditDelete: 'Delete',
  auditTimeRange: 'Time range',
  auditAllTime: 'All time',
  auditLast24h: 'Last 24 hours',
  auditLast7d: 'Last 7 days',
  auditLast30d: 'Last 30 days',
  auditTime: 'Time',
  auditAction: 'Action',
  auditDomain: 'Domain',
  auditSummary: 'Summary',
  auditStatus: 'Status',
  auditSession: 'Session',
  auditSucceeded: 'Succeeded',
  auditFailed: 'Failed',
  auditDomainFilter: 'Filter by domain',
  auditEmpty: 'No DNS changes have been recorded yet.',
  auditLoadFailed: 'Failed to load the audit log.',
  auditArgs: 'Arguments',
  auditDetail: 'Details',
  auditError: 'Error',
}

export function copyFor(locale: string): Copy {
  return locale.startsWith('en') ? EN : ZH
}

export type { LocaleFace }
