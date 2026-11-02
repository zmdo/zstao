import { buildPublicApi } from './build-public-api.mjs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as esbuild from 'esbuild'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
mkdirSync('lib', { recursive: true })

await esbuild.build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
})

await buildPublicApi(pkg)

if (!existsSync('src/client.tsx')) {
  process.exit(0)
}

const styles = []
const cssModules = {
  name: 'css-modules',
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8')
      const hash = createHash('sha1').update(args.path).update(source).digest('hex').slice(0, 8)
      const names = [...new Set([...source.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))]
      const map = Object.fromEntries(names.map((name) => [name, `dsh_${hash}_${name}`]))
      const css = source.replace(/(^|[^A-Za-z0-9_-])\.([A-Za-z_][\w-]*)/g, (match, prefix, name) => `${prefix}.${map[name] ?? name}`)
      styles.push(css)
      return { contents: `export default ${JSON.stringify(map)}`, loader: 'js' }
    })
  },
}

await esbuild.build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  loader: { '.css': 'text' },
  plugins: [cssModules],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

if (styles.length > 0) {
  const css = styles.join('\n')
  const bundle = readFileSync('lib/client.js', 'utf8')
  writeFileSync('lib/client.js', bundle + `\n;(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style) })();\n`)
}
