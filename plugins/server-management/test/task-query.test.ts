import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyTaskView } from '../src/client/shared/server-page-state.ts'
import { taskQuery } from '../src/client/servers/tasks/query.ts'

test('task history query keeps the server id, committed filters, page and page size', () => {
  const view = {
    ...emptyTaskView(20),
    query: 'needle',
    action: 'inspect',
    status: 'failed',
    from: '2026-10-19T08:00',
    to: '2026-10-19T09:00',
    page: 3,
  }
  const params = new URLSearchParams(taskQuery('server-a', view))
  assert.equal(params.get('server_id'), 'server-a')
  assert.equal(params.get('q'), 'needle')
  assert.equal(params.get('action'), 'inspect')
  assert.equal(params.get('status'), 'failed')
  assert.equal(params.get('page'), '3')
  assert.equal(params.get('page_size'), '20')
  assert.equal(params.get('from'), new Date(view.from).toISOString())
  assert.equal(params.get('to'), new Date(view.to).toISOString())

  const bare = new URLSearchParams(taskQuery('server-b', emptyTaskView()))
  assert.equal(bare.get('server_id'), 'server-b')
  assert.equal(bare.get('page'), '1')
  assert.equal(bare.get('page_size'), '20')
  assert.equal(bare.get('from'), null)
  assert.equal(bare.get('to'), null)
})
