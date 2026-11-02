import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/stack.sh', import.meta.url))
const source = readFileSync(script, 'utf8')

function pythonBody(): string {
  const start = source.indexOf("<<'PY'\n")
  const end = source.lastIndexOf('\nPY\n')
  assert.ok(start >= 0 && end > start, 'embedded python body not found')
  return source.slice(start + "<<'PY'\n".length, end)
}

test('recipe script keeps the request input separate from its HTTP helper', () => {
  const body = pythonBody()
  assert.doesNotMatch(body, /^\s*def\s+request\s*\(/m, 'request must not name a function')
  assert.match(body, /^request\s*=\s*json\.load\(/m)
  assert.match(body, /before = request\.get\('installed'\)/)
  assert.match(body, /change = request\['change'\]/)
})

const caseBase = {
  contractVersion: 2,
  operation: 'resolve',
  os: { family: 'builtin/ubuntu', release: '24.04', architecture: 'x86_64' },
  recipeRevision: 'r1',
  effectiveVersions: { kind: 'any' },
  installed: { state: 'missing' },
  target: { version: '1', targetIdentity: 'image:tag', packages: [], channel: 'stable' },
}

test('resolve returns an install change for every recipe without touching Docker', () => {
  const cases = [
    ['@smp/console-self-evolution/postgresql', '@smp/console-self-evolution/postgresql-docker'],
    ['@smp/console-self-evolution/onedev', '@smp/console-self-evolution/onedev-docker'],
    ['@smp/console-self-evolution/caddy', '@smp/console-self-evolution/caddy-docker'],
  ] as const
  for (const [software, recipe] of cases) {
    const result = spawnSync('sh', [script], {
      input: JSON.stringify({ ...caseBase, software, recipe }),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.operation, 'resolve')
    assert.equal(output.change.software, software)
    assert.equal(output.change.recipe, recipe)
    assert.equal(output.change.action, 'install')
    assert.deepEqual(output.change.before, caseBase.installed)
    assert.deepEqual(output.change.target, caseBase.target)
    assert.deepEqual(output.additionalRequirements, [])
  }
})

const testScript = fileURLToPath(new URL('../scripts/test.sh', import.meta.url))

test('test server recipes resolve without touching Docker', () => {
  const cases = [
    ['@smp/console-self-evolution/postgresql', '@smp/console-self-evolution/postgresql-test-docker'],
    ['@smp/console-self-evolution/caddy', '@smp/console-self-evolution/caddy-test-docker'],
  ] as const
  for (const [software, recipe] of cases) {
    const result = spawnSync('sh', [testScript], {
      input: JSON.stringify({ ...caseBase, software, recipe }),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.operation, 'resolve')
    assert.equal(output.change.software, software)
    assert.equal(output.change.recipe, recipe)
    assert.equal(output.change.action, 'install')
    assert.deepEqual(output.additionalRequirements, [])
  }
})

const hostScript = fileURLToPath(new URL('../scripts/host.sh', import.meta.url))

test('host recipes resolve without touching Docker', () => {
  const cases = [
    ['@smp/console-self-evolution/postgresql', '@smp/console-self-evolution/postgresql-prod-docker'],
    ['@smp/console-self-evolution/caddy', '@smp/console-self-evolution/caddy-prod-docker'],
    ['@smp/console-self-evolution/ces-host', '@smp/console-self-evolution/ces-host-bootstrap'],
  ] as const
  for (const [software, recipe] of cases) {
    const result = spawnSync('sh', [hostScript], {
      input: JSON.stringify({ ...caseBase, software, recipe }),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.operation, 'resolve')
    assert.equal(output.change.software, software)
    assert.equal(output.change.recipe, recipe)
    assert.equal(output.change.action, 'install')
  }
})
