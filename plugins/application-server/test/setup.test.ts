import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import type { TypeSetupContext } from '@smp/console-server-management/contracts'
import { setupApplicationServer } from '../src/setup.ts'

test('remote login receives current credentials only over stdin; removal needs no credentials', async () => {
  let password = 'first-secret', calls = 0, guards = 0
  const registry = { async pullLogin() { calls++; return { registry: 'registry.invalid', username: 'puller', password } } }
  const inputs: string[] = []
  const context: TypeSetupContext = {
    serverId: 'server', sshUser: 'ops', operation: 'prepare',
    async guard() { guards++ },
    async exec(command, timeout, options) {
      assert.equal(command.includes(password), false)
      assert.equal(command.includes('puller'), false)
      assert.ok(command.includes('sudo -n'))
      assert.ok(timeout >= 130_000)
      inputs.push(options!.stdin!)
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
    },
  }
  await setupApplicationServer(context, registry)
  password = 'updated-secret'
  await setupApplicationServer(context, registry)
  await setupApplicationServer({ ...context, operation: 'remove' }, registry)
  assert.equal(calls, 2)
  assert.equal(guards, 3)
  assert.equal(JSON.parse(inputs[0]!).password, 'first-secret')
  assert.equal(JSON.parse(inputs[1]!).password, 'updated-secret')
  assert.deepEqual(JSON.parse(inputs[2]!), { operation: 'remove' })
  await assert.rejects(setupApplicationServer({ ...context, exec: async () => ({ code: 1, stdout: password, stderr: password }) }, registry), error => {
    assert.equal(String(error).includes(password), false)
    return true
  })
})

test('remote credential file behavior', () => {
  execFileSync('python3', ['-B', new URL('login_test.py', import.meta.url).pathname], { stdio: 'pipe' })
})
