import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, cp, symlink, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const core = fileURLToPath(new URL('../', import.meta.url))
test('the packaged public API type-checks the real container plugin outside the repository', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'smp-api-consumer-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const archive = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: core, encoding: 'utf8' }))[0].filename
  const target = join(temp, 'node_modules/@smp/console-server-management')
  await mkdir(target, { recursive: true })
  execFileSync('tar', ['-xzf', join(temp, archive), '--strip-components=1', '-C', target])
  const files = await readdir(target)
  assert.ok(!files.includes('src'), 'the consumer must not resolve private source files')
  await symlink(dirname(require.resolve('react/package.json')), join(temp, 'node_modules/react'))
  await symlink(dirname(dirname(require.resolve('@types/react/package.json'))), join(temp, 'node_modules/@types'))
  await cp(new URL('../../server-containers/src/', import.meta.url), join(temp, 'src'), { recursive: true })
  await cp(new URL('../../server-containers/locale/', import.meta.url), join(temp, 'locale'), { recursive: true })
  await writeFile(join(temp, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', jsx: 'react-jsx',
    allowImportingTsExtensions: true, resolveJsonModule: true,
  }, include: ['src/**/*'] }))
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(temp, 'tsconfig.json')], { encoding: 'utf8' })
  const host = await readFile(new URL('../../server-containers/src/index.ts', import.meta.url), 'utf8')
  const client = await readFile(new URL('../../server-containers/src/client.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(host + client, /server-management\/src\//)
})
