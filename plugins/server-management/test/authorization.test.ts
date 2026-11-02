import assert from 'node:assert/strict'
import test from 'node:test'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { authorizeOperation } from '../src/host/harness/authorization.ts'
import { permissionFixture } from './fixtures/permissions.ts'
import { AdminRuntime } from '../src/host/admin/runtime.ts'
import { registerWorkspaceAdminTools } from '../src/host/admin/workspace-tools.ts'

const describe = () => ({ toolName: 'platform_server_admin', reason: 'Test operation' })

test('real full-access preset skips the real never approval service; switching back restores approval per call', async (t) => {
  const f = await permissionFixture(t)
  const exec = f.exec()
  f.set('danger-full-access')
  assert.equal(f.ctx.approval.overrideOf(f.session), 'never')
  // Reproduce the old failure using the actual host API.
  assert.equal(await f.ctx.approval.request({ agent: f.agent, toolName: 'fixture' }), 'rejected')
  assert.deepEqual(await authorizeOperation(exec, f.ctx.approval as never, describe), {
    allowed: true,
    authorization: { source: 'full-access', permissionMode: 'danger-full-access' },
  })
  assert.equal(f.prompts(), 0)
  f.set('workspace-write')
  assert.deepEqual(await authorizeOperation(exec, f.ctx.approval as never, describe), {
    allowed: true,
    authorization: { source: 'user-approval', permissionMode: 'workspace-write' },
  })
  assert.equal(f.prompts(), 1)
  f.answer('rejected')
  assert.deepEqual(await authorizeOperation(exec, f.ctx.approval as never, describe), {
    allowed: false,
    outcome: 'rejected',
  })
})

test('never alone, missing host permissions, missing agent and cancellation never grant full access', async (t) => {
  const f = await permissionFixture(t)
  f.set('workspace-write')
  setApprovalPolicy(f.session, 'never')
  assert.deepEqual(await authorizeOperation(f.exec(), f.ctx.approval as never, describe), {
    allowed: false,
    outcome: 'rejected',
  })
  f.set('danger-full-access')
  assert.deepEqual(
    await authorizeOperation(
      { ...f.exec(), permission: undefined },
      f.ctx.approval as never,
      describe,
    ),
    { allowed: false, outcome: 'rejected' },
  )
  assert.deepEqual(
    await authorizeOperation({ ...f.exec(), agent: undefined }, undefined, describe),
    { allowed: false, outcome: 'unavailable' },
  )
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(
    await authorizeOperation({ ...f.exec(), signal: controller.signal }, undefined, describe),
    { allowed: false, outcome: 'cancelled' },
  )
  assert.equal(f.prompts(), 0)
})

test('Auto with full sandbox still uses approval; a full-access label with restricted mode cannot bypass', async (t) => {
  const f = await permissionFixture(t)
  const dispose = f.ctx.permissionPresets.registerAuto(() => {})
  t.after(dispose)
  f.set('auto')
  assert.equal(f.ctx.sandboxPolicy.resolve({ session: f.session }).mode, 'danger-full-access')
  assert.equal(
    (await authorizeOperation(f.exec(), f.ctx.approval as never, describe)).allowed,
    true,
  )
  assert.equal(f.prompts(), 1)
  setApprovalPolicy(f.session, 'never')
  assert.deepEqual(await authorizeOperation(f.exec(), f.ctx.approval as never, describe), {
    allowed: false,
    outcome: 'rejected',
  })
  f.set('danger-full-access')
  setSandboxMode(f.session, 'read-only')
  assert.deepEqual(await authorizeOperation(f.exec(), f.ctx.approval as never, describe), {
    allowed: false,
    outcome: 'rejected',
  })
})

test('full access does not publish admin tools to a default-group session', async (t) => {
  const f = await permissionFixture(t)
  f.set('danger-full-access')
  let group = 'general'
  const agents = await f.ctx.plugin((scope) =>
    scope.provide('agents', { list: () => [f.agent] } as never),
  )
  const runtime = new AdminRuntime({} as never)
  const plugin = await f.ctx.plugin(
    Object.assign(
      (scope: typeof f.ctx) =>
        registerWorkspaceAdminTools(scope, runtime, { groupForSession: async () => group }),
      { inject: ['tools', 'agents', 'systemPrompt'] },
    ),
  )
  try {
    assert.equal(
      f.ctx.tools.schemas(f.agent).filter((tool) => tool.name.endsWith('_admin')).length,
      0,
    )
    group = 'server-ops'
    await f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent })
    assert.equal(
      f.ctx.tools.schemas(f.agent).filter((tool) => tool.name.endsWith('_admin')).length,
      5,
    )
    assert.equal(f.ctx.tools.schemas().filter((tool) => tool.name.endsWith('_admin')).length, 0)
    group = 'general'
    await f.ctx.systemPrompt.assemble({ agent: f.agent, scope: f.agent })
    assert.equal(
      f.ctx.tools.schemas(f.agent).filter((tool) => tool.name.endsWith('_admin')).length,
      0,
    )
  } finally {
    await plugin.dispose()
    await runtime.close()
    await agents.dispose()
  }
})
