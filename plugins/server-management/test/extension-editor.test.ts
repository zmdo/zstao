import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'
import { RequestScope } from '../src/client/shared/request-scope.ts'

const require = createRequire(import.meta.url)
test('superseded requests and disposed editors cannot publish late results', () => {
  const a = new RequestScope(), b = new RequestScope()
  const first = a.begin(), other = b.begin(), second = a.begin()
  assert.equal(first.current(), false)
  assert.equal(first.signal.aborted, true)
  assert.equal(other.current(), true)
  a.cancel()
  assert.equal(second.current(), false)
})

test('switching extension settings isolates late loads and preserves each draft', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'smp-editor-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const built = await build({
    entryPoints: [new URL('../src/client/servers/settings/ServerSettings.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.css': 'text' },
    plugins: [{ name: 'editor-boundaries', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, ({ path }) => ({ path: require.resolve(path), external: true }))
      builder.onLoad({ filter: /useServerForm\.ts$/ }, () => ({ contents: 'export function useServerForm() { return {} }', loader: 'js' }))
      builder.onLoad({ filter: /(?:BasicSettings|PolicySettings)\.tsx$/ }, () => ({ contents: 'export const BasicSettings = () => null; export const PolicySettings = () => null;', loader: 'js' }))
    } }],
  })
  const file = join(temp, 'editor.mjs')
  await writeFile(file, built.outputFiles[0]!.text)
  const { ServerSettings } = await import(pathToFileURL(file).href)
  const fetchBefore = globalThis.fetch
  const pending = new Map<string, (response: Response) => void>()
  globalThis.fetch = (async (url: string) => new Promise<Response>((resolve) => pending.set(new URL(url, 'http://test').searchParams.get('key')!, resolve))) as typeof fetch
  t.after(() => { globalThis.fetch = fetchBefore })
  const entries = ['a', 'b'].map((key) => ({ key: `@test/${key}`, owner: '@test', kind: 'settings', name: { zh: key, en: key }, order: 0 }))
  const slots = { entriesOfSlot: () => entries.map((e) => ({ options: { key: e.key } })), subscribe: () => () => {} }
  let view: renderer.ReactTestRenderer
  await act(async () => {
    view = renderer.create(React.createElement(ServerSettings, {
      active: 'en', serverId: 'server', server: { id: 'server', group_id: null }, extensions: entries, slots,
      onSaved() {}, onDeleted() {},
      renderSlot: (_slot: string, owner: { settings: { value: string; onChange(value: string): void } }, options: { entryKey: string }) =>
        React.createElement('input', { 'data-entry': options.entryKey, value: owner.settings.value, onChange: owner.settings.onChange }),
    }))
  })
  t.after(() => { act(() => view.unmount()) })
  const select = async (key: string) => { await act(async () => { view.root.findAllByProps({ role: 'tab' }).find((tab) => tab.children[0] === key)!.props.onClick() }) }
  const respond = async (key: string) => { await act(async () => { pending.get(`@test/${key}`)!(new Response(JSON.stringify({ value: key, revision: '1' }))) }) }
  const input = (key: string) => view.root.findByProps({ 'data-entry': `@test/${key}` })
  await select('a')
  await select('b')
  await respond('b')
  await act(async () => { input('b').props.onChange('draft-b') })
  await respond('a')
  assert.equal(input('b').props.value, 'draft-b')
  await select('a')
  assert.equal(input('a').props.value, 'a')
  await act(async () => { input('a').props.onChange('draft-a') })
  await select('b')
  assert.equal(input('b').props.value, 'draft-b')
  await select('a')
  assert.equal(input('a').props.value, 'draft-a')
  // A's save may finish after B is active; it must only update A's retained editor.
  await act(async () => {
    const actions = view.root.findByProps({ 'data-extension-actions': '@test/a' })
    actions.findAllByType('button').find((button) => button.children[0] === 'Save')!.props.onClick()
  })
  await select('b')
  await respond('a')
  assert.equal(input('b').props.value, 'draft-b')
})
