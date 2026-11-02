import assert from 'node:assert/strict'
import test from 'node:test'
import { approvalText, type ApprovalLabels } from '../src/host/admin/approval-copy.ts'
import { approve } from '../src/host/admin/approval.ts'
import { downloadLocale, keyDownloadPage, localePreference } from '../src/host/admin/download-copy.ts'
import type { AdminContext, AdminDeps } from '../src/host/admin/model.ts'
import type { PreparedPlan } from '../src/shared/changes.ts'

const server = {
  name: 'web-01', host: 'web.example.test', ssh_port: 22, ssh_user: 'root',
  ssh_key_id: 'old-key', key_name: 'production', key_fingerprint: 'SHA256:old',
  group_id: 'staging', type_key: 'web', install_required_software: false,
  declared_os: { kind: 'custom', text: 'My Linux' },
}
const labels: ApprovalLabels = {
  groups: [{ id: 'staging', name: 'Staging', name_i18n: { en: 'Staging', zh: '测试环境' } },
    { id: 'prod', name: 'Production', name_i18n: { en: 'Production', zh: '生产环境' } }],
  types: [{ key: 'web', name_i18n: { en: 'Web server', zh: 'Web 服务器' }, software: [], supportedOs: { kind: 'all' } }],
  software: [{ software_key: 'vendor/nginx', name_i18n: { en: 'Nginx', zh: 'Nginx' } }],
}
const render = (language: string, tool: string, action: string, preview: unknown) =>
  approvalText(language, `platform_${tool}_admin`, action, 'target', preview, labels)
const prepared: PreparedPlan = {
  definitionRevision: 'revision', os: { family: 'ubuntu', version: '24.04', architecture: 'x86_64' },
  changes: [{ software: 'vendor/nginx', recipe: 'vendor/recipe', recipeRevision: '1', action: 'replace',
    before: { state: 'installed', version: '1.26.2', targetIdentity: '1', packages: [], healthy: true },
    target: { version: '2.0.0', targetIdentity: '2', packages: [], channel: 'stable' },
    dependencies: [], effects: [{ kind: 'service-restart', description: { en: 'Restart Nginx', zh: '重启 Nginx' } }],
    payload: { internalScript: 'DO_NOT_DISPLAY' },
  }], risks: { major: true, replacement: true, serviceImpact: true },
}
const plan = {
  id: 'plan-123', request_snapshot: { selection: { serverIds: ['server'], versions: {} } },
  targets: [{ server_snapshot: { name: server.name, host: server.host }, target_snapshot: prepared }],
}
const window = { start: '2026-10-23T12:00:00Z', end: '2026-10-23T13:00:00Z', timezone: 'Asia/Shanghai' }

test('configuration approvals show translated field differences and only applicable connection effects', () => {
  const preview = { before: { ...server, requested_key: { name: 'new key', fingerprint: 'SHA256:new' } },
    parameters: { patch: { ssh_port: 2222, ssh_user: 'deploy', ssh_key_id: 'new-key',
      declared_os: { kind: 'catalog', name: 'Ubuntu 24.04', family: 'ubuntu', version: '24.04' },
      install_required_software: true } } }
  const zh = render('zh', 'server', 'update', preview), en = render('en', 'server', 'update', preview)
  assert.match(zh, /SSH 端口：22 → 2222/)
  assert.match(zh, /操作系统：My Linux → Ubuntu 24.04/)
  assert.match(zh, /停用 → 启用/)
  assert.match(en, /SSH user: root → deploy/)
  assert.match(en, /production \(SHA256:old\) → new key \(SHA256:new\)/)
  assert.match(en, /checked after saving/)
  const metadata = render('en', 'server', 'update', { before: server, parameters: { patch: { name: 'renamed', ssh_port: 22 } } })
  assert.doesNotMatch(metadata, /checked after saving|SSH port/)
  assert.equal(render('fr', 'server', 'update', preview), en)
})

test('draft, apply and cancel approvals describe their different effects and frozen upgrade details', () => {
  const draft = render('en', 'server_upgrade', 'plan', { before: server, parameters: { versions: { 'vendor/nginx': '2.0.0' } } })
  assert.match(draft, /Nginx: 2.0.0/)
  assert.match(draft, /requires approval of the prepared plan/)
  const zh = render('zh', 'server_upgrade', 'apply', { before: plan, parameters: window })
  const en = render('en', 'server_upgrade', 'apply', { before: plan, parameters: window })
  for (const text of [zh, en]) {
    assert.match(text, /web-01/); assert.match(text, /web.example.test/); assert.match(text, /plan-123/)
    assert.match(text, /20:00:00/); assert.match(text, /21:00:00/); assert.match(text, /Asia\/Shanghai/)
    assert.match(text, /1.26.2 → 2.0.0/); assert.doesNotMatch(text, /DO_NOT_DISPLAY|payload|review_digest/)
  }
  assert.match(zh, /跨主版本升级/); assert.match(zh, /重启 Nginx/); assert.match(zh, /软件替换/)
  assert.match(en, /major-version upgrade/); assert.match(en, /Restart Nginx/)
  const cancel = render('en', 'server_upgrade', 'cancel', { before: plan })
  assert.match(cancel, /Running steps may still finish/); assert.match(cancel, /will not be rolled back/)
})

test('group changes resolve names, policy rules and deferred execution without dumping objects', () => {
  const preview = { before: server, parameters: { target_group: 'prod', install_missing: true,
    software_policies: [{ software_key: 'vendor/nginx', restriction: { kind: 'minimum', version: '1.26' }, detect_updates: false }] } }
  const zh = render('zh', 'server', 'rebind', preview), en = render('en', 'server', 'rebind', preview)
  assert.match(zh, /测试环境 → 生产环境/); assert.match(zh, /Web 服务器/); assert.match(zh, /更新检测：停用/)
  assert.match(en, /Staging → Production/); assert.match(en, /1.26/)
  assert.doesNotMatch(zh + en, /\[object Object\]|software_policies|target_group/)
})

test('retention distinguishes recurring authorization, disabling and a frozen one-off batch', () => {
  const parameters = { mode: 'set', days: 30, archive_directory: '/audit/archive', next_run: '2026-10-24T00:00:00Z', enabled: true }
  const enabled = render('en', 'audit', 'retention', { before: null, parameters })
  assert.match(enabled, /future scheduled runs/); assert.match(enabled, /10,000/); assert.match(enabled, /UTC/)
  const disabled = render('zh', 'audit', 'retention', { parameters: { ...parameters, enabled: false } })
  assert.match(disabled, /不再自动启动/); assert.match(disabled, /30/); assert.doesNotMatch(disabled, /之后每天执行/)
  const run = render('en', 'audit', 'retention', { policy: parameters, cutoff: '2026-09-24T00:00:00Z', count: 1234 })
  assert.match(run, /1,234/); assert.match(run, /deleted from the database after the archive is verified/)
  const exportText = render('zh', 'audit', 'export', { filter: { status: 'failed', from: '2026-10-22T12:00:00Z', page: 2, page_size: 20 }, maximum_records: 10000 })
  assert.match(exportText, /失败/); assert.match(exportText, /开始时间（含）/); assert.match(exportText, /10,000/)
  assert.doesNotMatch(exportText, /page|page_size/)
})

test('all remaining mutation approvals have complete English and Chinese copy', () => {
  const cases: [string, string, unknown][] = [
    ['server_group', 'create', { parameters: { name: '应用 {count}' } }],
    ['server_group', 'rename', { before: { name: 'old' }, parameters: { name: 'new' } }],
    ['server_group', 'delete', { before: { name: 'old', members: [server] } }],
    ['server_key', 'create', { parameters: { name: 'new' } }],
    ['server_key', 'delete', { before: { name: 'key', fingerprint: 'SHA256:old' } }],
    ['server_key', 'rotate', { before: server, phase: 'new', new_fingerprint: 'SHA256:new' }],
    ['server_key', 'rotate', { before: server, phase: 'switched', old_fingerprint: 'SHA256:original', new_fingerprint: 'SHA256:new' }],
    ['server', 'delete', { before: server }],
  ]
  for (const [tool, action, preview] of cases) {
    const zh = render('zh', tool, action, preview), en = render('en', tool, action, preview)
    assert.notEqual(zh, en); assert.ok(zh.length > 10); assert.ok(en.length > 10)
    assert.doesNotMatch(zh + en, /undefined|\[object Object\]|"parameters"/)
  }
  assert.match(render('en', 'server_key', 'rotate', cases[6]![2]), /Resume.*SHA256:original/s)
  assert.throws(() => render('en', 'server', 'unsupported', {}), /approval_description_unavailable/)
})

test('the approval request uses localized prose and rejection still records the structured snapshot', async () => {
  const queries: { sql: string; params?: unknown[] }[] = []
  const deps = {
    db: { async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params })
      return { rows: sql.startsWith('select username') ? [{ username: 'owner' }] : [] }
    } }, definitions: { publicCatalog: () => [] }, catalog: [],
  } as never as AdminDeps
  const preview = { before: null, parameters: { name: 'Production' } }
  const ctx: AdminContext = { agent: { id: 'session' }, callId: 'call', signal: new AbortController().signal,
    approval: { async request(request) {
      assert.equal(request.reason, request.displayReason?.en)
      assert.equal(request.displayReason?.zh, '创建服务器分组“Production”。')
      assert.doesNotMatch(request.reason!, /"preview"|"parameters"/)
      return 'rejected'
    } } }
  await assert.rejects(approve(deps, ctx, 'platform_server_group_admin', 'create', 'new', preview), /approval_denied/)
  const audit = queries.find(query => query.sql.startsWith('insert into server_audit_log'))!
  assert.deepEqual((audit.params![9] as { before: unknown }).before, preview)
})

test('private-key confirmation follows saved locale then browser preferences and safely escapes names', () => {
  const settings = { describe: () => [{ ns: 'locale', value: { preference: 'zh' } }] }
  assert.equal(downloadLocale(localePreference(settings), 'en-US'), 'zh')
  assert.equal(downloadLocale('en', 'zh-CN'), 'en')
  assert.equal(downloadLocale('fr', 'zh-CN'), 'en')
  assert.equal(downloadLocale(undefined, 'en;q=0.2,zh-CN;q=0.9'), 'zh')
  assert.equal(downloadLocale(undefined, 'zh;q=0,en-US'), 'en')
  assert.equal(downloadLocale(undefined, 'fr-FR'), 'en')
  assert.equal(localePreference(undefined), undefined)
  const zh = keyDownloadPage('zh', { name: '<script>alert(1)</script>', fingerprint: 'SHA256:abc' }, 'abc123', 'nonce')
  const en = keyDownloadPage('en', { name: 'production', fingerprint: 'SHA256:abc' }, 'abc123', 'nonce')
  assert.match(zh, /lang="zh"/); assert.match(zh, /确认并下载私钥/)
  assert.match(zh, /&lt;script&gt;/); assert.doesNotMatch(zh, /<script>/)
  assert.match(en, /lang="en"/); assert.match(en, /Confirm and download private key/)
  assert.match(en, /name="token" value="abc123"/)
  assert.doesNotMatch(en, /<pre>|secret|ciphertext|"servers"/)
})
