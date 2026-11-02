import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAuditQuery } from '../src/host/http/audit-query.ts'

test('audit queries validate pagination, status and time filters', () => {
  const parsed = parseAuditQuery(new URLSearchParams({ page: '2', page_size: '50', status: 'succeeded', hours: '24', q: ' uname ' }))
  assert.deepEqual({ page: parsed.page, pageSize: parsed.pageSize, status: parsed.status, query: parsed.query }, {
    page: 2,
    pageSize: 50,
    status: 'succeeded',
    query: 'uname',
  })
  assert.ok(parsed.since instanceof Date)
  for (const query of [
    { page: '0' },
    { page_size: '25' },
    { status: 'online' },
    { kind: 'delete' },
    { hours: '1' },
  ])
    assert.throws(() => parseAuditQuery(new URLSearchParams(query)), { status: 422 })
})
