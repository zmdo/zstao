import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { act, create } from 'react-test-renderer'

test('pull credential form sends expected revision, preserves blank password, and clears a submitted password', async t => {
  const directory = await mkdtemp(join(process.cwd(), '.pull-client-test-'))
  const originalFetch = globalThis.fetch
  t.after(async () => { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }) })
  const built = await build({ entryPoints: ['src/pull-credential-settings.tsx'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.css': 'text' }, external: ['react','react/jsx-runtime'] })
  const file = join(directory, 'client.mjs'); await writeFile(file, built.outputFiles[0]!.text)
  const { PullCredentialSettings } = await import(pathToFileURL(file).href)
  const value = { id: 'platform-pull', revision: 1, registry: 'registry.example', username: 'pull', repositories: ['team/*'], configured: true, enabled: true, updatedAt: null }
  const writes: Record<string, unknown>[] = []
  globalThis.fetch = async (input, init) => {
    const path = String(input)
    if (path.endsWith('/pull-credentials')) {
      if (init?.method === 'POST') { writes.push(JSON.parse(String(init.body))); value.revision++; return Response.json(value) }
      return Response.json(value)
    }
    if (path.endsWith('/targets')) return Response.json({ targets: [] })
    if (path.endsWith('/clients')) return Response.json({ clients: [] })
    return Response.json({ bindings: [] })
  }
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(React.createElement(PullCredentialSettings, { zh: true })) })
  t.after(() => act(() => renderer.unmount()))
  const save = () => renderer.root.findAllByType('button').find(button => button.children.includes('保存拉取凭据'))!.props.onClick()
  await act(async () => { save() })
  assert.equal(writes[0]!.expectedRevision, 1); assert.equal(writes[0]!.password, '')
  const password = () => renderer.root.findAllByType('input').find(input => input.props.type === 'password')!
  await act(async () => { password().props.onChange({ target: { value: 'new-secret-fixture' } }) })
  await act(async () => { save() })
  assert.equal(writes[1]!.expectedRevision, 2); assert.equal(writes[1]!.password, 'new-secret-fixture')
  assert.equal(password().props.value, '')
  assert.equal(JSON.stringify(renderer.toJSON()).includes('new-secret-fixture'), false)
})
