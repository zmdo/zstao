import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AdminRuntime } from '../src/host/admin/runtime.ts'
import { registerWorkspaceAdminTools } from '../src/host/admin/workspace-tools.ts'
import { ADMIN_ACTIONS } from '../src/host/admin/service.ts'
import { validateAdminInput } from '../src/host/admin/contracts.ts'

async function fixture(t: test.TestContext, mode: 'native' | 'ptc' = 'native') {
  const ctx = new Context()
  const agents: Agent[] = []
  const groups = new Map<string, string>()
  const dependencies = await ctx.plugin((scope: Context) => {
    scope.provide('agents', { list: () => agents } as never)
    scope.provide('ptcRuntime', { language: 'typescript', programFormat: 'function-body' } as never)
  })
  const prompt = await ctx.plugin(SystemPrompt, {})
  const tools = await ctx.plugin(ToolRuntime, { mode })
  const ownedScopes: (() => Promise<void>)[] = []
  const makeAgent = async (id: string, group: string) => {
    const agent = { id } as Agent
    groups.set(id, group)
    const owner = await ctx.plugin(
      Object.assign(
        (inner: Context) => {
          const scope = createScope(inner as never, agent)
          Object.assign(agent, { ctx: scope.ctx })
        },
        { inject: ['tools', 'systemPrompt'] },
      ),
    )
    ownedScopes.push(async () => {
      await owner.dispose()
    })
    agents.push(agent)
    return agent
  }
  const general = await makeAgent('general-session', 'general')
  const ops = await makeAgent('ops-session', 'server-ops')
  const unassigned = await makeAgent('unassigned-session', 'unassigned')
  const runtime = new AdminRuntime({} as never)
  let lookup = async (id: string) => groups.get(id)
  const plugin = await ctx.plugin(
    Object.assign(
      async (scope: Context) => {
        await registerWorkspaceAdminTools(scope, runtime, { groupForSession: (id) => lookup(id) })
      },
      { inject: ['tools', 'systemPrompt', 'agents'] },
    ),
  )
  t.after(async () => {
    await plugin.dispose()
    await runtime.close()
    for (const dispose of ownedScopes.reverse()) await dispose()
    await tools.dispose()
    await prompt.dispose()
    await dependencies.dispose()
  })
  const assemble = (agent: Agent) => ctx.systemPrompt.assemble({ agent, scope: agent })
  const names = (agent?: Agent) =>
    ctx.tools
      .schemas(agent)
      .map((tool) => tool.name)
      .sort()
  return {
    ctx,
    general,
    ops,
    unassigned,
    groups,
    plugin,
    makeAgent,
    assemble,
    names,
    setLookup: (next: typeof lookup) => {
      lookup = next
    },
  }
}

const names = Object.keys(ADMIN_ACTIONS).sort()

test('admin registration refuses root and unscoped plugin contexts before publishing any tool', async (t) => {
  const f = await fixture(t)
  const runtime = new AdminRuntime({} as never)
  assert.throws(
    () => runtime.registerForAgent({ id: 'root', ctx: f.ctx } as Agent, async () => {}),
    /requires a scoped context/,
  )
  const plugin = await f.ctx.plugin(
    Object.assign(
      (ctx: Context) => {
        assert.throws(
          () => runtime.registerForAgent({ id: 'plugin', ctx } as Agent, async () => {}),
          /requires a scoped context/,
        )
      },
      { inject: ['tools'] },
    ),
  )
  await plugin.dispose()
  assert.deepEqual(f.names(), [])
  assert.deepEqual(f.names(f.general), [])
  assert.deepEqual(f.names(f.ops), names)
  await runtime.close()
})

test('scoped admin tools expose structured actions without secret or approval overrides', async (t) => {
  const f = await fixture(t)
  for (const name of names) {
    const definition = f.ctx.tools.get(name, f.ops)!
    const properties = definition.parameters.properties as Record<string, JsonSchemaNode>
    assert.deepEqual(Object.keys(properties), ['action', 'input'])
    assert.equal(properties.input!.type, 'object')
    assert.equal(properties.input!.additionalProperties, false)
    assert.ok(Object.keys(properties.input!.properties!).length > 0)
    for (const forbidden of ['approved', 'private_key', 'password', 'approvalId', 'command']) {
      assert.ok(!Object.hasOwn(properties.input!.properties!, forbidden))
    }
    assert.ok(properties.action!.enum!.length > 1)
  }
  assert.deepEqual(f.names(), [])
})

test('published native schema describes nested policies, OS and patch; action checks reject before dependencies or approval', async (t) => {
  const f = await fixture(t)
  const serverTool = f.ctx.tools.get('platform_server_admin', f.ops)!
  const properties = (serverTool.parameters as JsonSchemaNode).properties!.input!.properties!
  assert.equal(properties.software_policies!.items!.properties!.restriction!.oneOf!.length, 5)
  assert.equal(properties.patch!.properties!.declared_os!.oneOf!.length, 2)
  assert.match(serverTool.description, /Creating a plan does not execute/)
  assert.match(serverTool.description, /platform_server_upgrade_admin.show/)
  const valid = {
    action: 'rebind',
    input: {
      server: 'fixture',
      expected_config_revision: '1',
      target_group: null,
      install_missing: true,
      software_policies: [],
    },
  }
  assert.deepEqual(validateJsonSchemaValue(serverTool.parameters as JsonSchemaNode, valid, ''), [])
  validateAdminInput('platform_server_admin', valid.action, valid.input)
  const typesTool = f.ctx.tools.get('platform_server_group_admin', f.ops)!
  assert.deepEqual(
    validateJsonSchemaValue(
      typesTool.parameters as JsonSchemaNode,
      { action: 'types', input: { group_id: null } },
      '',
    ),
    [],
  )
  const invalid = [
    {
      action: 'rebind',
      input: {
        server: 'fixture',
        expected_config_revision: '1',
        target_group: null,
        software_policies: [],
      },
      field: 'install_missing',
    },
    {
      action: 'update',
      input: { server: 'fixture', expected_config_revision: '1' },
      field: 'patch',
    },
    {
      action: 'delete',
      input: { server: 'fixture', expected_config_revision: '1', target_type: 'extra' },
      field: 'target_type',
    },
    {
      action: 'rebind',
      input: {
        ...valid.input,
        software_policies: [
          { software_key: 'x', restriction: { kind: 'exact' }, detect_updates: true },
        ],
      },
      field: 'restriction',
    },
  ]
  for (const { action, input, field } of invalid) {
    const result = await f.ctx.tools.execute({
      name: 'platform_server_admin',
      arguments: { action, input },
      agent: f.ops,
      callId: 'contract-test' as never,
      signal: new AbortController().signal,
    })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result.content), new RegExp(field))
    assert.doesNotMatch(
      JSON.stringify(result.content),
      /undefined.*(query|request)|approval_denied/,
    )
  }
})

test('action contracts require retention set fields and exact version strings', () => {
  assert.doesNotThrow(() =>
    validateAdminInput('platform_audit_admin', 'retention', { mode: 'get' }),
  )
  assert.throws(
    () => validateAdminInput('platform_audit_admin', 'retention', { mode: 'set', days: 30 }),
    /archive_directory/,
  )
  assert.throws(
    () => validateAdminInput('platform_audit_admin', 'retention', { mode: 'get', enabled: true }),
    /enabled/,
  )
  assert.throws(
    () =>
      validateAdminInput('platform_server_upgrade_admin', 'plan', {
        server: 'x',
        expected_config_revision: '1',
        versions: { docker: 28 },
      }),
    /input.versions.docker/,
  )
  assert.throws(
    () =>
      validateAdminInput('platform_server_upgrade_admin', 'plan', {
        server: 'x',
        expected_config_revision: '1',
        versions: {},
      }),
    /at least one/,
  )
})

test('only server-ops sessions expose admin tools; global, default and unassigned scopes cannot call them', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(f.names(), [])
  assert.deepEqual(f.names(f.general), [])
  assert.deepEqual(f.names(f.unassigned), [])
  assert.deepEqual(f.names(f.ops), names)
  assert.deepEqual((await f.assemble(f.general)).tools, [])
  assert.deepEqual((await f.assemble(f.ops)).tools.map((tool) => tool.name).sort(), names)
  assert.deepEqual(f.names(), [])
  for (const agent of [undefined, f.general, f.unassigned]) {
    const result = await f.ctx.tools.execute({
      name: 'platform_server_key_admin',
      arguments: { action: 'list', input: {} },
      callId: 'workspace-test' as never,
      signal: new AbortController().signal,
      agent,
    })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result.content), /unknown tool/)
  }
})

test('workspace association after agent creation and later removal update the next model request', async (t) => {
  const f = await fixture(t)
  const agent = await f.makeAgent('new-session', 'unassigned')
  assert.deepEqual((await f.assemble(agent)).tools, [])
  f.groups.set(agent.id, 'server-ops')
  assert.deepEqual((await f.assemble(agent)).tools.map((tool) => tool.name).sort(), names)
  assert.deepEqual(f.names(), [])
  const previous = f.ctx.tools.get('platform_server_key_admin', agent)!
  f.groups.set(agent.id, 'general')
  // A retained tool handle must reject before querying secrets or requesting approval.
  await assert.rejects(
    previous.execute({ action: 'list', input: {} }, { agent } as never),
    /server_ops_workspace_required/,
  )
  assert.deepEqual((await f.assemble(agent)).tools, [])
  assert.deepEqual(f.names(agent), [])
  assert.deepEqual(f.names(f.ops), names)
})

test('PTC SDK includes admin declarations only for the operations workspace', async (t) => {
  const f = await fixture(t, 'ptc')
  const general = await f.assemble(f.general)
  const ops = await f.assemble(f.ops)
  for (const name of names) {
    assert.ok(!general.sections.some((section) => section.text.includes(name)))
    assert.ok(ops.sections.some((section) => section.text.includes(name)))
  }
  const sdk = ops.sections.map((section) => section.text).join('\n')
  assert.match(sdk, /software_policies/)
  assert.match(sdk, /detect_updates/)
  assert.match(sdk, /review_digest/)
  assert.match(sdk, /Creating a plan does not execute/)
  assert.match(sdk, /JSON.parse/)
  f.groups.set(f.ops.id, 'general')
  const removed = await f.assemble(f.ops)
  for (const name of names)
    assert.ok(!removed.sections.some((section) => section.text.includes(name)))
  assert.deepEqual(
    f.names().filter((name) => name.endsWith('_admin')),
    [],
  )
})

test('unloading waits for pending membership reads and retracts all scoped tools', async (t) => {
  const f = await fixture(t)
  let resolve!: (value: string) => void
  let entered!: () => void
  const started = new Promise<void>((r) => {
    entered = r
  })
  f.setLookup(async () => {
    entered()
    return new Promise<string>((r) => {
      resolve = r
    })
  })
  const assembly = f.assemble(f.ops)
  await started
  let closed = false
  const disposal = Promise.resolve(f.plugin.dispose()).then(() => {
    closed = true
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(closed, false)
  resolve('server-ops')
  await Promise.all([assembly, disposal])
  assert.deepEqual(f.names(f.ops), [])
  assert.deepEqual(f.names(f.general), [])
})
