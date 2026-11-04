import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { act, create } from 'react-test-renderer'
let directory = ''
let CodeRepositoriesPage: React.ComponentType<any>
let SavedPassword: React.ComponentType<any>
const shaA = 'a'.repeat(40)
const shaB = 'b'.repeat(40)
const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
const originalDocument = globalThis.document
const timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
let hashListeners: Record<string, (() => void)[]> = {}
let visibility: (() => void) | undefined
before(async () => {
  directory = await mkdtemp(join(process.cwd(), '.client-test-'))
  const result = await build({ stdin: { contents: "export { CodeRepositoriesPage } from './src/repository-browser.tsx'; export { SavedPassword } from './src/password-view.tsx'", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'text' }, plugins: [{ name: 'host-ui-test-double', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'ui', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react'; export const CodeBlock=({code})=>React.createElement('pre',null,code); export const FileTypeIcon=()=>null; export const IconFolderOpenRegular=()=>null; export const IconFolderCloseRegular=()=>null; export const classifyFileType=()=> 'code'; export const languageForPath=()=> 'typescript';", loader: 'js' }))
  } }] })
  const file = join(directory, 'client.mjs'); await writeFile(file, result.outputFiles[0].text)
  const module = await import(pathToFileURL(file).href); CodeRepositoriesPage = module.CodeRepositoriesPage; SavedPassword = module.SavedPassword
})
after(async () => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; globalThis.document = originalDocument; globalThis.setTimeout = timers.setTimeout; globalThis.clearTimeout = timers.clearTimeout; await rm(directory, { recursive: true, force: true }) })
function browser(hash: string) {
  hashListeners = {}
  globalThis.window = { location: { hash }, history: { pushState(_s: unknown, _t: string, hash: string) { window.location.hash = hash }, replaceState(_s: unknown, _t: string, hash: string) { window.location.hash = hash } },
    addEventListener(name: string, handler: () => void) { (hashListeners[name] ??= []).push(handler) }, removeEventListener(name: string, handler: () => void) { hashListeners[name] = hashListeners[name]?.filter(h => h !== handler) } } as any
  globalThis.document = { hidden: false, addEventListener(name: string, handler: () => void) { if (name === 'visibilitychange') visibility = handler }, removeEventListener() { visibility = undefined } } as any
}
const tick = () => act(async () => { await new Promise(resolve => timers.setTimeout(resolve, 0)) })
const locale = { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} }
test('a late response from an old SHA cannot replace the newly selected branch', async () => {
  browser(`#console=project-code-repositories&repo=1&ref=main&type=branch&sha=${shaA}&path=x.ts&kind=file`)
  let finishOld: ((value: Response) => void) | undefined
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://test')
    if (url.pathname.endsWith('/repos/1')) return Response.json({ project: { name: 'Repo', path: 'Repo', webUrl: 'https://example.com' }, defaultBranch: 'main', branches: ['main', 'feature/name'], tags: [], cloneUrl: 'https://example.com/Repo.git' })
    if (url.pathname.endsWith('/resolve')) return Response.json({ sha: shaB })
    if (url.pathname.endsWith('/tree')) return Response.json({ entries: [{ path: 'x.ts', isFile: true }], truncated: false })
    if (url.searchParams.get('sha') === shaA) return new Promise(resolve => { finishOld = resolve })
    return Response.json({ path: 'x.ts', size: 3, content: 'NEW-CONTENT', binary: false, truncated: false, highlight: true, downloadable: true })
  }
  let renderer: ReturnType<typeof create>
  await act(async () => { renderer = create(React.createElement(CodeRepositoriesPage, { locale })) })
  await tick()
  assert(finishOld)
  await act(async () => { renderer!.root.findByType('select').props.onChange({ target: { value: JSON.stringify(['branch', 'feature/name']) } }) })
  await tick()
  assert(JSON.stringify(renderer!.toJSON()).includes('NEW-CONTENT'))
  await act(async () => finishOld!(Response.json({ path: 'x.ts', content: 'OLD-CONTENT', size: 3, binary: false, truncated: false, highlight: true, downloadable: true })))
  assert.equal(JSON.stringify(renderer!.toJSON()).includes('OLD-CONTENT'), false)
  assert.match(window.location.hash, new RegExp(shaB))
  await act(async () => renderer!.unmount())
})
test('password reveal clears on timeout and visibility change, and ignores a late response after hide', async () => {
  browser('')
  let expire: (() => void) | undefined
  globalThis.setTimeout = ((callback: () => void, delay: number) => { if (delay === 30_000) { expire = callback; return 999 } return timers.setTimeout(callback, delay) }) as any
  globalThis.clearTimeout = ((id: any) => { if (id === 999) expire = undefined; else timers.clearTimeout(id) }) as any
  globalThis.fetch = async () => Response.json({ password: 'saved-password-fixture' })
  let renderer: ReturnType<typeof create>
  await act(async () => { renderer = create(React.createElement(SavedPassword, { zh: true })) })
  const click = (label: string) => renderer!.root.findAllByType('button').find(button => button.children.includes(label))!.props.onClick()
  await act(async () => click('显示'))
  assert.equal(renderer!.root.findByType('output').children.join(''), 'saved-password-fixture')
  await act(async () => expire!())
  assert.equal(renderer!.root.findByType('output').children.join(''), '••••••••')
  await act(async () => click('显示'))
  await act(async () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); visibility!() })
  assert.equal(renderer!.root.findByType('output').children.join(''), '••••••••')
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  let finish: ((response: Response) => void) | undefined
  globalThis.fetch = () => new Promise(resolve => { finish = resolve })
  await act(async () => click('显示'))
  await act(async () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); visibility!() })
  await act(async () => finish!(Response.json({ password: 'late-secret' })))
  assert.equal(renderer!.root.findByType('output').children.join(''), '••••••••')
  await act(async () => renderer!.unmount())
  globalThis.setTimeout = timers.setTimeout; globalThis.clearTimeout = timers.clearTimeout
})
