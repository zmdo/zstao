import { readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as esbuild from 'esbuild'

const require = createRequire(import.meta.url)
export async function buildPublicApi(pkg) {
  const entries = ['contracts', 'client-api'].filter((entry) => pkg.exports?.[`./${entry}`])
  if (!entries.length) return
  for (const entry of entries)
    await esbuild.build({ entryPoints: [`src/${entry}.ts`], outfile: `lib/${entry}.js`,
      bundle: true, format: 'esm', platform: 'neutral', packages: 'external' })
  // All declarations are generated; remove stale modules left by source moves.
  rmSync('lib/types', { recursive: true, force: true })
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.api.json'], { stdio: 'inherit' })
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  await buildPublicApi(JSON.parse(readFileSync('package.json', 'utf8')))
