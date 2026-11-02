import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

test('client and shared modules depend only on their declared boundaries, including type imports', async () => {
  for (const scope of ['shared', 'client']) {
    const names = await readdir(path.join(sourceRoot, scope), { recursive: true })
    const files = names
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => path.join(sourceRoot, scope, name))
    if (scope === 'client') files.push(path.join(sourceRoot, 'client.tsx'))
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      for (const match of text.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
        const specifier = match[2]!
        if (!specifier.startsWith('.')) {
          assert.equal(scope, 'client', `${file} must not import ${specifier}`)
          assert.ok(
            ['react', 'react/jsx-runtime', '@smp/console-kit', '@smp/console-kit/dialog', '@xterm/xterm', '@xterm/addon-fit', '@xterm/xterm/css/xterm.css'].includes(specifier),
            `${file}: ${specifier}`,
          )
          continue
        }
        const target = path.relative(sourceRoot, path.resolve(path.dirname(file), specifier))
        const allowed =
          target.startsWith('shared/') ||
          (scope === 'client' && target.startsWith('client/')) ||
          (scope === 'shared' && /^\.\.\/locale\/[^/]+\.json$/.test(target))
        assert.ok(allowed, `${file} crosses its ${scope} boundary through ${specifier}`)
      }
    }
  }
})

test('host and client entry points have no runtime module cycles', async () => {
  for (const entry of ['index.ts', 'client.tsx']) {
    const result = await build({
      absWorkingDir: sourceRoot,
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: entry === 'index.ts' ? 'node' : 'browser',
      packages: 'external',
      loader: { '.css': 'text' },
      metafile: true,
      logLevel: 'silent',
    })
    const graph = new Map(
      Object.entries(result.metafile!.inputs).map(([name, input]) => [
        name,
        input.imports.filter((item) => !item.external).map((item) => item.path),
      ]),
    )
    const visited = new Set<string>()
    const visiting: string[] = []
    function visit(name: string): void {
      assert.ok(!visiting.includes(name), `${entry}: ${[...visiting, name].join(' → ')}`)
      if (visited.has(name)) return
      visiting.push(name)
      for (const dependency of graph.get(name) ?? []) visit(dependency)
      visiting.pop()
      visited.add(name)
    }
    for (const name of graph.keys()) visit(name)
  }
})

test('HTTP, workflows and repositories preserve their host boundaries and transaction ownership', async () => {
  const names = await readdir(path.join(sourceRoot, 'host'), { recursive: true })
  for (const name of names.filter((name) => name.endsWith('.ts'))) {
    const file = path.join(sourceRoot, 'host', name),
      source = await readFile(file, 'utf8')
    const persistence = name.includes('/persistence/')
    const repository = persistence && /(?:repository|catalog-lock)\.ts$/.test(name)
    const database = name.startsWith('database/')
    const storageTypes = persistence && /(?:rows|inputs)\.ts$/.test(name)
    const http = name.startsWith('http/')
    const workflow = /(?:service|list|queries|enrollment)\.ts$/.test(name)
    if (!repository && !database)
      assert.doesNotMatch(source, /\.query\s*(?:<|\()/, `${name} must delegate SQL`)
    if (repository) {
      assert.doesNotMatch(source, /\.query\s*\(/, `${name} must declare its SQL result type`)
      assert.doesNotMatch(source, /\.connect\s*\(/, `${name} must use the caller's connection`)
      assert.doesNotMatch(
        source,
        /['"](?:begin|commit|rollback)['"]/,
        `${name} must not finish the caller's transaction`,
      )
    }
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
      const specifier = match[2]!
      const target = specifier.startsWith('.')
        ? path.relative(sourceRoot, path.resolve(path.dirname(file), specifier))
        : specifier
      if (http) assert.doesNotMatch(target, /\/persistence\//, `${name} must call the application boundary`)
      if (workflow || repository) {
        assert.notEqual(specifier, 'node:http', `${name} must be independent of HTTP`)
        assert.doesNotMatch(specifier, /(?:^|\/)http\//, `${name} must not depend on HTTP adapters`)
      }
      if (repository)
        assert.doesNotMatch(
          specifier,
          /(?:service|queries|routes)\.ts$/,
          `${name} must not depend on workflows`,
        )
      if (database)
        assert.ok(target.startsWith('host/database/'), `${name} must not depend on business modules`)
      if (storageTypes) {
        assert.doesNotMatch(target, /shared\/dto\//, `${name} must not use HTTP DTOs as database rows`)
        assert.doesNotMatch(
          target,
          /(?:repository|service|detect|queries|routes)\.ts$/,
          `${name} must not depend on implementations`,
        )
      }
    }
    if (storageTypes) {
      // Rows and write inputs describe data; they cannot import live services or open connections.
      for (const match of source.matchAll(/^import\s+([\s\S]+?)\s+from\s+['"]/gm))
        assert.ok(match[1]!.startsWith('type '), `${name} must use type-only imports`)
      assert.doesNotMatch(source, /^export\s+(?:async\s+)?(?:function|class|const|let)\b/m)
    }
  }
})

test('recipe evaluation and definition resolution remain independent of storage and task execution', async () => {
  const files = (await readdir(path.join(sourceRoot, 'host/recipes')))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => 'host/recipes/' + name)
  files.push('host/definitions/resolver.ts', 'host/definitions/validation.ts', 'host/definitions/views.ts')
  for (const name of files) {
    const file = path.join(sourceRoot, name),
      source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
      const specifier = match[2]!
      if (!specifier.startsWith('.')) continue
      const target = path.relative(sourceRoot, path.resolve(path.dirname(file), specifier))
      assert.doesNotMatch(
        target,
        /\/persistence\/|host\/(?:execution|http|servers)\//,
        `${name}: ${specifier}`,
      )
      assert.ok(!target.startsWith('host/database/'), `${name} must not depend on database infrastructure`)
    }
  }
})

test('wire DTOs and public plugin contracts have independent data-only boundaries', async () => {
  for (const scope of ['dto', 'contracts']) {
    const directory = path.join(sourceRoot, 'shared', scope)
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.ts')) continue
      const file = path.join(directory, name)
      const source = await readFile(file, 'utf8')
      assert.doesNotMatch(source, /\bDate\b/, `${scope}/${name} must use serializable values`)
      assert.doesNotMatch(source, /secret_ciphertext|private_key/, `${scope}/${name} must not expose secrets`)
      assert.doesNotMatch(source, /^export\s+(?:async\s+)?(?:function|class|const|let)\b/m)
      for (const match of source.matchAll(/^import\s+([\s\S]+?)\s+from\s+(['"])([^'"]+)\2/gm)) {
        assert.ok(match[1]!.startsWith('type '), `${scope}/${name} must use type-only imports`)
        if (scope === 'contracts')
          assert.doesNotMatch(match[3]!, /(?:^|\/)dto\//, `${name} must not depend on HTTP DTOs`)
      }
    }
  }
})
