import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { quote } from '../src/host/recipes/script.ts'
import { REMOTE_SUPERVISOR } from '../src/host/remote/supervisor.ts'

const script = (response: unknown) => ({
  interpreter: 'posix-sh',
  body: `printf '%s' ${quote(JSON.stringify(response))}`,
  outputLimitBytes: 4096,
})
const installed = { state: 'installed', healthy: true, targetIdentity: 'docker.io=29.1.3-1' }

function runWorker(execution: unknown, verification: unknown, alreadyInstalled = false) {
  const step = {
    environment: {},
    request: {
      change: { software: 'test/docker', action: 'install', before: { state: 'missing' }, target: { targetIdentity: installed.targetIdentity } },
    },
    detect: script({ operation: 'detect', result: alreadyInstalled ? installed : { state: 'missing' } }),
    execute: script(execution),
    verify: script(verification),
  }
  // Exercise the production worker and its durable result in a disposable directory,
  // without running the privileged main entry point or installing any software.
  const result = spawnSync('python3', ['-c', `
import sys,json,tempfile,os
data=json.load(sys.stdin)
scope={}
exec(data['source'].rsplit('try:main()',1)[0],scope)
with tempfile.TemporaryDirectory(prefix='smp-supervisor-test-') as path:
 lock=os.open(path+'/lock',os.O_CREAT|os.O_RDWR,0o600)
 scope['worker'](data['request'],path,lock)
 with open(path+'/result.json') as f:print(f.read())
`], {
    input: JSON.stringify({ source: REMOTE_SUPERVISOR, request: { digest: 'test', steps: [step] } }),
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  return JSON.parse(result.stdout)
}

test('remote execution failure retains recipe diagnostics and already applied package changes', () => {
  const changes = [{ name: 'docker.io', version: '29.1.3-1' }]
  const result = runWorker(
    { operation: 'execute', state: 'failed', changes, code: 'installation_failed', detail: 'Cannot add Docker access user ubuntu: cannot lock /etc/group' },
    {},
  )
  assert.equal(result.state, 'failed')
  assert.equal(result.steps[0].state, 'failed')
  assert.deepEqual(result.steps[0].changes, changes)
  assert.match(result.error, /execution_failed: installation_failed:.*ubuntu.*cannot lock/)
})

test('an already installed target still verifies required access and retains its failure reason', () => {
  const result = runWorker(
    { operation: 'execute', state: 'failed', changes: [], code: 'must_not_run' },
    { operation: 'verify', result: installed, healthy: false, code: 'docker_group_membership_missing', detail: 'Confirmed SSH user is not a member of the docker group' },
    true,
  )
  assert.equal(result.state, 'failed')
  assert.match(result.error, /verification_failed: docker_group_membership_missing:/)
  assert.deepEqual(result.steps[0].changes, [])
})

test('successful execution preserves configuration changes in the durable journal', () => {
  const changes = [{ kind: 'group-membership', user: 'ubuntu', uid: 1000, group: 'docker' }]
  const result = runWorker(
    { operation: 'execute', state: 'completed', changes },
    { operation: 'verify', result: installed, healthy: true },
  )
  assert.equal(result.state, 'completed')
  assert.deepEqual(result.steps[0].changes, changes)
})
