import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { GROUP_FLOW_SLOT, NATIVE_FLOW_SLOT, PICKER_SLOT, mirrorPickerFlow } from '../src/picker-flow.ts'

test('the native picker and directory component keep separate child ownership across reload and unload', async t => {
  const source = new URL('../../../tmp/deepseek-harness/packages/client/ui-slots/src/index.ts', import.meta.url)
  if (!existsSync(source)) { t.skip('The pinned dsh source checkout is not available'); return }
  const { SlotCore } = await import(source.href)
  const core = new SlotCore()
  core.register({ name: 'root', children: { [PICKER_SLOT]: { kind: 'single', scope: 'root' } } }, () => null)
  const native = core.register({ name: PICKER_SLOT, children: { [NATIVE_FLOW_SLOT]: { kind: 'single', scope: 'root' } } }, () => null)
  const adapter = core.register({ name: PICKER_SLOT, priority: -100, children: { [GROUP_FLOW_SLOT]: { kind: 'single', scope: 'root' } } }, () => null)
  const component = () => null
  const injected = () => ({ listDirectory: () => [] })
  let originalFlow = core.register({ name: NATIVE_FLOW_SLOT, inject: injected }, component)
  const stop = mirrorPickerFlow({
    entries: key => core.entries(key), entriesOfSlot: key => core.entriesOfSlot(key), subscribe: (key, listener) => core.subscribe(key, listener),
    register: (options, entry) => core.register(options, entry), inject: () => { throw new Error('The mirror does not own declarations') },
  })
  await Promise.resolve()
  assert.equal(core.entries(GROUP_FLOW_SLOT)[0].component, component)
  assert.equal(core.entries(GROUP_FLOW_SLOT)[0].inject, injected)
  assert.equal(core.entries(NATIVE_FLOW_SLOT).length, 1)
  originalFlow(); await Promise.resolve()
  assert.equal(core.entries(GROUP_FLOW_SLOT).length, 0)
  const replacement = () => null
  originalFlow = core.register({ name: NATIVE_FLOW_SLOT, inject: injected }, replacement)
  await Promise.resolve()
  assert.equal(core.entries(GROUP_FLOW_SLOT)[0].component, replacement)
  stop()
  assert.equal(core.entries(GROUP_FLOW_SLOT).length, 0)
  originalFlow(); native(); adapter()
  assert.equal(core.specDynamic(NATIVE_FLOW_SLOT), undefined)
  assert.equal(core.specDynamic(GROUP_FLOW_SLOT), undefined)
})
