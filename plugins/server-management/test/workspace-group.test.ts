import assert from 'node:assert/strict'
import test from 'node:test'
import { SERVER_OPS_GROUP, registerServerOpsGroup } from '../src/host/workspace-group.ts'

test('the server management plugin registers its Harness conversation group', async () => {
  const calls: unknown[] = []
  await registerServerOpsGroup({ async register(input) { calls.push(input) } })
  assert.deepEqual(calls, [SERVER_OPS_GROUP])
  assert.equal(SERVER_OPS_GROUP.id, 'server-ops')
  assert.equal(SERVER_OPS_GROUP.labelI18n.zh, '服务器运维')
  assert.equal(SERVER_OPS_GROUP.directory, '.smp/server-ops-workspaces')
})
