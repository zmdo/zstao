import assert from 'node:assert/strict'
import test from 'node:test'
import { displayStatus, type ActiveOperation } from '../src/host/servers/list.ts'
import { parseServerListQuery } from '../src/host/http/server-query.ts'

const now = Date.parse('2026-10-19T09:00:00Z')
function base() {
  return { row: { reachability: 'online', connection_error: null, last_checked_at: new Date(now - 1000), os_checked_at: new Date(now - 1000) },
    verification: 'matched', available: true, compatible: true, software: [], now, maxAge: 90_000 }
}
function operation(overrides: Partial<ActiveOperation> = {}): ActiveOperation {
  return { id: 'task', server_id: 'server', state: 'running', phase: 'installing', mutation_phase: 'installing',
    lease_expires_at: new Date(now + 60_000), result: null, ...overrides }
}
test('server status requires fresh evidence and separates unavailable, missing and unknown facts', () => {
  assert.equal(displayStatus(base()).code, 'normal')
  assert.equal(displayStatus({ ...base(), verification: 'custom', row: { ...base().row, os_checked_at: null } }).code, 'normal')
  assert.equal(displayStatus({ ...base(), row: { ...base().row, reachability: 'unknown' } }).code, 'unverified')
  assert.equal(displayStatus({ ...base(), row: { ...base().row, last_checked_at: new Date(now - 90_001) } }).code, 'unverified')
  assert.equal(displayStatus({ ...base(), row: { ...base().row, os_checked_at: null } }).code, 'unverified')
  for (const values of [{ available: false }, { compatible: false }, { verification: 'mismatch' }])
    assert.equal(displayStatus({ ...base(), ...values }).code, 'attention')
  for (const software of [
    { key: 'test/agent', state: 'missing', healthy: null, compliant: false },
    { key: 'test/agent', state: 'installed', healthy: false, compliant: true },
    { key: 'test/agent', state: 'installed', healthy: true, compliant: false },
  ]) assert.equal(displayStatus({ ...base(), software: [software] }).code, 'attention')
  assert.equal(displayStatus({ ...base(), software: [{ key: 'test/agent', state: 'unknown', healthy: null, compliant: false }] }).code, 'unverified')
  assert.equal(displayStatus({ ...base(), software: [{ key: 'test/agent', state: 'installed', healthy: true, compliant: true }] }).code, 'normal')
})
test('actual mutation stages override disconnects, while expired and unknown recovery require attention', () => {
  const disconnected = { ...base(), row: { ...base().row, reachability: 'offline', connection_error: { message: 'authentication failed' } } }
  assert.equal(displayStatus({ ...disconnected, verification: 'mismatch' }).code, 'disconnected')
  assert.equal(displayStatus({ ...disconnected, operation: operation() }).code, 'installing')
  assert.equal(displayStatus({ ...disconnected, operation: operation({ phase: 'verifying' }) }).code, 'installing')
  assert.equal(displayStatus({ ...disconnected, operation: operation({ phase: 'upgrading', mutation_phase: 'upgrading' }) }).code, 'upgrading')
  assert.equal(displayStatus({ ...base(), operation: operation({ phase: 'connecting', mutation_phase: null }) }).code, 'normal')
  assert.equal(displayStatus({ ...base(), operation: operation({ lease_expires_at: new Date(now - 1) }) }).code, 'attention')
  const recovering = operation({ state: 'recovering', phase: 'reconciling' })
  assert.equal(displayStatus({ ...base(), operation: recovering }).code, 'attention')
  assert.equal(displayStatus({ ...base(), operation: { ...recovering, result: { remote_state: 'running', remote_checked_at: new Date(now - 1000).toISOString() } } }).code, 'installing')
  assert.equal(displayStatus({ ...base(), operation: { ...recovering, result: { remote_state: 'running', remote_checked_at: new Date(now - 91_000).toISOString() } } }).code, 'attention')
  assert.equal(displayStatus({ ...base(), operation: { ...recovering, mutation_phase: null } }).code, 'normal')
})
test('server query validation rejects unsupported filters and limits before reading the database', () => {
  assert.equal(parseServerListQuery(new URLSearchParams()).pageSize, 10)
  assert.equal(parseServerListQuery(new URLSearchParams({ group_id: 'ungrouped' })).groupId, '')
  assert.equal(parseServerListQuery(new URLSearchParams({ page_size: '100', status: 'attention', order: 'last_checked' })).status, 'attention')
  const invalid: Record<string, string>[] = [ { group_id: 'bad' }, { status: 'online' }, { order: 'anything' },
    { page: '0' }, { page: '1.1' }, { page: '1000001' }, { page_size: '101' }, { q: 'x'.repeat(201) } ]
  for (const query of invalid) assert.throws(() => parseServerListQuery(new URLSearchParams(query)), { code: 'server_query_invalid' })
})
