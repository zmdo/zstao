import assert from 'node:assert/strict'
import test from 'node:test'
import { navGroups, pageLabel, pageRoutes, visibleGroups, withoutPages } from '../src/pages.ts'
import { shellCopy } from '../src/copy.ts'
import { checkNewPassword, cleanUsername } from '../src/security.ts'
import { newSecret, provisioningUri } from '../src/totp.ts'
import { decryptMnemonic, encryptMnemonic } from '../src/vault.ts'

test('harness settings sits with login security under platform settings', () => {
  const routes = pageRoutes([
    { options: { key: 'settings', label: pageLabel('登录安全', { group: 'platform', groupLabel: '平台设置', placement: 'footer' }), order: 5 } },
    { options: { key: 'general', label: pageLabel('通用', { group: 'platform', groupLabel: '平台设置', placement: 'footer' }), order: 0 } },
    { options: { key: 'harness', label: pageLabel('Harness', { group: 'platform', groupLabel: '平台设置', placement: 'footer' }), order: 10 } },
    { options: { key: 'markets', label: '行情', order: 30 } },
  ])
  const groups = navGroups(routes)
  assert.deepEqual(groups.nav.map(group => group.label), ['行情'])
  assert.deepEqual(groups.footer[0]?.pages.map(page => page.label), ['通用', '登录安全', 'Harness'])
  assert.equal(groups.footer[0]?.icon, '')
  assert.equal(groups.footer[0]?.navigation, 'tabs')
})

test('sidebar routes follow the pages plugins registered', () => {
  const routes = pageRoutes([
    { options: { key: 'servers', label: '服务器', order: 20 } },
    { options: { key: 'settings', label: pageLabel('登录安全', { group: 'platform', groupLabel: '平台设置', placement: 'footer' }), order: 0 } },
    { options: { key: 'mcp', label: pageLabel('MCP', { group: 'platform', groupLabel: '平台设置', placement: 'footer' }), order: 10 } },
    { options: { key: 'markets', label: '行情', order: 30 } },
    { options: { key: 'hidden' } },
  ])
  const groups = navGroups(routes)
  assert.deepEqual(groups.nav.map(group => group.label), ['服务器', '行情'])
  assert.deepEqual(groups.footer.map(group => group.label), ['平台设置'])
  assert.deepEqual(groups.footer[0]?.pages.map(page => page.label), ['登录安全', 'MCP'])
})

test('sidebar child pages keep their order and workspace visibility without changing other groups', () => {
  const server = { group: 'server-management', groupLabel: '服务器管理', navigation: 'sidebar' as const }
  const routes = pageRoutes([
    { options: { key: 'server-upgrades', label: pageLabel('升级管理', server), order: 2 } },
    { options: { key: 'ssh-keys', label: pageLabel('服务器密钥', server), order: 1 } },
    { options: { key: 'servers', label: pageLabel('服务器实例', { ...server, icon: 'server' }), order: 0 } },
    { options: { key: 'agent-chat', label: pageLabel('会话', { group: 'agent', groupLabel: 'Harness' }), order: 0 } },
    { options: { key: 'archive', label: pageLabel('档案', { group: 'agent', groupLabel: 'Harness' }), order: 1 } },
  ])
  const groups = navGroups(routes)
  const servers = groups.nav.find(group => group.id === server.group)
  assert.equal(servers?.navigation, 'sidebar')
  assert.equal(servers?.icon, 'server')
  assert.deepEqual(servers?.pages.map(page => page.key), ['servers', 'ssh-keys', 'server-upgrades'])
  assert.equal(groups.nav.find(group => group.id === 'agent')?.navigation, 'tabs')
  assert.deepEqual(navGroups(withoutPages(routes, ['ssh-keys'])).nav.find(group => group.id === server.group)?.pages.map(page => page.key), ['servers', 'server-upgrades'])
  assert.equal(navGroups(withoutPages(routes, ['servers', 'ssh-keys', 'server-upgrades'])).nav.some(group => group.id === server.group), false)
})

test('shell labels are read again when the locale changes', () => {
  let active = 'zh'
  const page = {
    options: {
      key: 'settings',
      label: pageLabel(() => shellCopy(active).security, {
        group: 'platform',
        groupLabel: () => shellCopy(active).platform,
        placement: 'footer' as const,
      }),
      order: 0,
    },
  }
  assert.equal(pageRoutes([page])[0]?.label, '安全')
  active = 'en'
  const next = pageRoutes([page])
  assert.equal(next[0]?.label, 'Security')
  assert.equal(navGroups(next).footer[0]?.label, 'Platform settings')
})

test('harness tabs stay out of the menu list', () => {
  const routes = pageRoutes([
    { options: { key: 'agent-chat', label: pageLabel('会话', { group: 'agent', groupLabel: 'Harness' }), order: 0 } },
    { options: { key: 'archive', label: pageLabel('档案', { group: 'agent', groupLabel: 'Harness' }), order: 1 } },
    { options: { key: 'markets', label: '行情', order: 30 } },
  ])
  const groups = navGroups(routes)
  assert.deepEqual(visibleGroups(groups).nav.map(group => group.id), ['markets'])
  assert.deepEqual(groups.nav.find(group => group.id === 'agent')?.pages.map(page => page.label), ['会话', '档案'])
})

test('the earliest page names the group icon', () => {
  const marked = pageRoutes([{
    options: {
      key: 'general',
      label: pageLabel('通用', { group: 'platform', groupLabel: '平台设置', icon: 'settings' }),
      order: 0,
    },
  }, {
    options: {
      key: 'later',
      label: pageLabel('后来', { group: 'platform', groupLabel: '后来', icon: 'box' }),
      order: 5,
    },
  }])
  assert.equal(navGroups(marked).nav[0]?.icon, 'settings')
})

test('a username with a space is rejected', () => {
  assert.equal(cleanUsername('  admin  ').body?.username, 'admin')
  assert.equal(cleanUsername('a b').ok, false)
  assert.equal(cleanUsername('   ').ok, false)
})

test('a new password must differ and stay within the bcrypt limit', () => {
  assert.equal(checkNewPassword('old', 'old').ok, false)
  assert.equal(checkNewPassword('old', 'x'.repeat(73)).ok, false)
  assert.equal(checkNewPassword('old', 'newer').ok, true)
})

test('a new authenticator secret is a provisioning uri', () => {
  const secret = newSecret()
  assert.equal(secret.length, 32)
  assert.equal(
    provisioningUri('JBSWY3DPEHPK3PXP', 'admin'),
    'otpauth://totp/%E7%AD%96%E7%95%A5%E6%8E%A7%E5%88%B6%E5%8F%B0%3Aadmin?secret=JBSWY3DPEHPK3PXP&issuer=%E7%AD%96%E7%95%A5%E6%8E%A7%E5%88%B6%E5%8F%B0',
  )
})

test('a wallet mnemonic round-trips through the password vault', async () => {
  const stored = await encryptMnemonic('secret', 'abandon abandon abandon')
  assert.equal(await decryptMnemonic('secret', stored), 'abandon abandon abandon')
  await assert.rejects(() => decryptMnemonic('other', stored))
})

test('a page hidden for the current workspace group leaves the menu', () => {
  const routes = pageRoutes([
    { options: { key: 'markets', label: '行情', order: 30 } },
    { options: { key: 'workspace-group-gate', label: '临时页面', order: 40 } },
  ])
  assert.deepEqual(withoutPages(routes, ['workspace-group-gate']).map(route => route.key), ['markets'])
  assert.deepEqual(withoutPages(routes, []).map(route => route.key), ['markets', 'workspace-group-gate'])
})
