import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('real release wrapper never removes the old container after a failed pull and reuses a prepared digest', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ces-runtime-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin'); await mkdir(bin)
  const source = await readFile(new URL('../../../deploy/ces-runtime.sh', import.meta.url), 'utf8')
  const script = join(root, 'runtime.sh')
  await writeFile(script, source.replace('ROOT=/srv/ces-prod', `ROOT='${root}/runtime'`))
  const log = join(root, 'commands')
  await writeFile(join(bin, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG"
case "$1" in
  inspect) echo registry.example/team/previous@sha256:bbbb ;;
  pull) exit 1 ;;
esac
`, { mode: 0o700 })
  await writeFile(join(bin, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  await writeFile(join(bin, 'curl'), '#!/bin/sh\nprintf 200\n', { mode: 0o700 })
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_COMMAND_LOG: log }
  const image = 'registry.example/team/app@sha256:' + 'a'.repeat(64)
  await assert.rejects(promisify(execFile)('sh', [script, 'install', '--digest', image], { env }))
  const failed = await readFile(log, 'utf8')
  assert.match(failed, /pull /); assert.doesNotMatch(failed, /rm -f|run -d/)
  await writeFile(log, '')
  await promisify(execFile)('sh', [script, 'install', '--digest', image], { env: { ...env, CES_PREPARED_IMAGE: image, DOCKER_CONFIG: '/platform/config' } })
  const succeeded = await readFile(log, 'utf8')
  assert.doesNotMatch(succeeded, /pull /); assert.match(succeeded, /image inspect/); assert.match(succeeded, /run -d/)
})
