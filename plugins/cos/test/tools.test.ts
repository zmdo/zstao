import assert from 'node:assert/strict'
import test from 'node:test'
import { registerCosTools } from '../src/host/tools.ts'

test('the batch tool is registered with a strict ops schema', () => {
  const registered: Array<Record<string, any>> = []
  const scope = {
    tools: {
      register(tool: Record<string, any>) {
        registered.push(tool)
        return () => {}
      },
    },
    get: () => undefined,
  }
  registerCosTools(scope as never, { pool: {} as never, secrets: {} as never })
  const tool = registered.find((entry) => entry.name === 'platform_cos_batch')
  assert.ok(tool)
  const schema = tool.parameters
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['ops'])
  assert.equal(schema.properties.ops.type, 'array')
  assert.equal(schema.properties.ops.items.additionalProperties, false)
  assert.deepEqual(schema.properties.ops.items.required, ['op'])
  assert.deepEqual(schema.properties.ops.items.properties.op.enum, ['move', 'copy', 'delete', 'upload'])
})
