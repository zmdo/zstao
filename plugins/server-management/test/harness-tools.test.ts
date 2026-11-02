import assert from 'node:assert/strict'
import test from 'node:test'
import { registerServerTools } from '../src/host/harness/tools.ts'

test('server harness tools expose only managed-server arguments', () => {
  const definitions: { name: string; description: string; parameters: { properties?: Record<string, unknown>; required?: string[] } }[] = []
  const ctx = { tools: { register: (definition: (typeof definitions)[number]) => definitions.push(definition) } }
  registerServerTools(ctx as never, {} as never)
  assert.deepEqual(definitions.map((definition) => definition.name), [
    'platform_server_list',
    'platform_server_group_list',
    'platform_server_exec',
    'platform_server_rsync',
    'platform_server_get',
  ])
  const list = definitions[0]!
  assert.deepEqual(Object.keys(list.parameters.properties ?? {}), ['query', 'status', 'group', 'page', 'page_size'])
  const groups = definitions[1]!
  assert.deepEqual(Object.keys(groups.parameters.properties ?? {}), ['query', 'page', 'page_size'])
  const exec = definitions[2]!
  assert.deepEqual(Object.keys(exec.parameters.properties ?? {}), ['server', 'command', 'timeout_ms', 'command_max_bytes', 'output_limit_bytes'])
  assert.match(String(exec.parameters.properties?.timeout_ms?.description), /30000/)
  assert.match(String(exec.parameters.properties?.command_max_bytes?.description), /8192/)
  assert.match(String(exec.parameters.properties?.output_limit_bytes?.description), /65536/)
  const rsync = definitions[3]!
  assert.deepEqual(Object.keys(rsync.parameters.properties ?? {}), ['server', 'command', 'timeout_ms'])
  const get = definitions[4]!
  assert.deepEqual(Object.keys(get.parameters.properties ?? {}), ['server'])
  for (const definition of definitions) assert.match(definition.description, /managed/i)
})
