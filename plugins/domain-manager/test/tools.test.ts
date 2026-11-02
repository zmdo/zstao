import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDomainTools } from '../src/host/tools.ts'

interface Definition {
  name: string
  description: string
  parameters: { properties?: Record<string, unknown>; required?: string[] }
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<string>
}

const ROW = {
  id: '9d68a1d7-ca9d-4307-af4a-f2cfc7d767db',
  name: 'zstao.com',
  zone_id: 'zone-1',
  account_id: 'feef70b0bfcf5a408a9e8ad1988fc412',
  account_name: 'Acme',
  status: 'active',
  description: 'company site',
  filed: true,
  created_at: '2026-11-02T00:00:00.000Z',
  token_ciphertext: 'token',
}

const AUDIT_ROWS = [
  {
    id: '1',
    tool: 'platform_domain_dns_create',
    action: 'create',
    domain_name: 'zstao.com',
    summary: '新增 TXT _probe.zstao.com -> x',
    reason: '测试记录',
    ok: true,
    error: null,
    created_at: '2026-11-03T00:00:00.000Z',
  },
]

function harness(approvalOutcome: string | undefined, rows: unknown[] = [ROW], auditRows: unknown[] = AUDIT_ROWS) {
  const definitions = new Map<string, Definition>()
  const audits: unknown[] = []
  const scope = {
    tools: {
      register(definition: Definition) {
        definitions.set(definition.name, definition)
        return () => undefined
      },
    },
    get(name: string) {
      if (name === 'approval' && approvalOutcome !== undefined) {
        return { request: async () => approvalOutcome }
      }
      return undefined
    },
  }
  const pool = {
    async query(text: string, values: unknown[] = []) {
      if (text.startsWith('insert into domain_manager_audit')) {
        audits.push(values)
        return { rows: [] }
      }
      if (text.includes('from domain_manager_audit')) return { rows: auditRows }
      if (text.includes('domain_manager_domains')) return { rows }
      return { rows: [] }
    },
  }
  const secrets = { decrypt: (token: string) => token }
  registerDomainTools(scope as never, { pool: pool as never, secrets })
  return { definitions, audits }
}

const exec = { agent: { id: 'session-1', session: {} }, callId: 'call-1', signal: new AbortController().signal }

test('domain tools cover listing, DNS changes and the audit query', () => {
  const { definitions } = harness('allowed-once')
  assert.deepEqual([...definitions.keys()], [
    'platform_domain_list',
    'platform_domain_dns_list',
    'platform_domain_dns_create',
    'platform_domain_dns_update',
    'platform_domain_dns_delete',
    'platform_domain_audit_list',
  ])
  const create = definitions.get('platform_domain_dns_create')!
  assert.deepEqual(Object.keys(create.parameters.properties ?? {}), ['domain', 'type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment', 'reason'])
  assert.deepEqual(create.parameters.required, ['domain', 'type', 'name', 'content', 'reason'])
  const update = definitions.get('platform_domain_dns_update')!
  assert.deepEqual(Object.keys(update.parameters.properties ?? {}), ['domain', 'record_id', 'type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment', 'reason'])
  for (const definition of definitions.values()) assert.match(definition.description, /managed|DNS|audit/i)
})

test('a write tool refuses an unmanaged domain before any Cloudflare call', async () => {
  const { definitions } = harness('allowed-once', [])
  const result = await definitions.get('platform_domain_dns_create')!.execute(
    { domain: 'other.com', type: 'TXT', name: 'x', content: 'y', reason: 'test' },
    exec,
  )
  assert.match(result, /domain_not_found/)
})

test('a write tool requires a non-blank reason before approval', async () => {
  const { definitions, audits } = harness('allowed-once')
  const result = await definitions.get('platform_domain_dns_create')!.execute(
    { domain: 'zstao.com', type: 'TXT', name: '_probe.zstao.com', content: 'x', reason: '   ' },
    exec,
  )
  assert.match(result, /invalid_argument/)
  assert.match(result, /reason/)
  assert.equal(audits.length, 0)
})

test('a denied approval returns approval_denied and records the failed audit with the reason', async () => {
  const { definitions, audits } = harness('denied')
  const result = await definitions.get('platform_domain_dns_create')!.execute(
    { domain: 'zstao.com', type: 'TXT', name: '_probe.zstao.com', content: 'x', reason: '验证记录' },
    exec,
  )
  assert.match(result, /approval_denied/)
  assert.match(result, /denied/)
  assert.equal(audits.length, 1)
  const values = audits[0] as unknown[]
  assert.equal(values[1], 'platform_domain_dns_create')
  assert.equal(values[7], '验证记录')
  assert.equal(values[8], false)
})

test('an invalid TTL is rejected before approval', async () => {
  const { definitions, audits } = harness('allowed-once')
  const result = await definitions.get('platform_domain_dns_create')!.execute(
    { domain: 'zstao.com', type: 'TXT', name: '_probe.zstao.com', content: 'x', ttl: 30, reason: 'test' },
    exec,
  )
  assert.match(result, /invalid_argument/)
  assert.equal(audits.length, 0)
})

test('the audit tool returns records with their reasons', async () => {
  const { definitions } = harness('allowed-once')
  const payload = JSON.parse(await definitions.get('platform_domain_audit_list')!.execute({ limit: 10 }, exec))
  assert.equal(payload.count, 1)
  assert.equal(payload.items[0].reason, '测试记录')
  assert.equal(payload.items[0].summary, '新增 TXT _probe.zstao.com -> x')
})
