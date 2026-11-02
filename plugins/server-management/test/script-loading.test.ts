import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadScript, scriptCommand } from '../src/host/recipes/script.ts'
import { ServerError } from '../src/shared/errors.ts'

test('loaded recipes execute their frozen bytes after the source file changes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'smp-script-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'recipe.sh')
  await writeFile(path, `printf '%s' "original ' script"`)
  const loaded = await loadScript({ path, interpreter: 'posix-sh', timeoutMs: 1000, outputLimitBytes: 4096 })
  await writeFile(path, `printf '%s' 'modified'`)
  assert.equal(Object.isFrozen(loaded), true)
  const result = spawnSync('sh', ['-c', scriptCommand(loaded)], { encoding: 'utf8', timeout: 1000 })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, "original ' script")
})

test('script loading rejects invalid locations, limits and executable text before publication', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'smp-script-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'recipe.sh'),
    valid = { path, interpreter: 'posix-sh' as const, timeoutMs: 1000, outputLimitBytes: 4096 }
  await writeFile(path, 'exit 0')
  const rejected = (error: unknown) => error instanceof ServerError && error.code === 'component_script_path'
  for (const patch of [{ path: 'relative.sh' }, { timeoutMs: 99 }, { outputLimitBytes: 255 }])
    await assert.rejects(loadScript({ ...valid, ...patch }), rejected)
  await writeFile(path, 'exit 0\0')
  await assert.rejects(loadScript(valid), rejected)
  await writeFile(path, '#'.repeat(1_048_577))
  await assert.rejects(loadScript(valid), rejected)
})
