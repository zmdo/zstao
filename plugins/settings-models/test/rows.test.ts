import assert from 'node:assert/strict'
import test from 'node:test'
import { addedRows, createOps, draftError, fieldOp, listedModels, matchProvider, missingDiscovery, modelRows, protocolChoice, protocolWire, providerBaseURL, providerChoices, providerRoute, resolveProvider, storedModels, toggleAllModels } from '../src/rows.ts'
test('only a provider saved by the user is listed', () => {
  const catalog = [
    { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], defaultBaseURL: 'https://api.openai.com/v1' },
    { provider: 'anthropic', displayName: 'Anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'] },
    { provider: 'deepseek-account', displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] },
  ]
  const documents = [{
    ns: 'llm-pi-ai',
    revision: 4,
    value: { providers: { openai: { baseURL: 'https://example.test/v1', api: 'openai-completions', models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }] }, anthropic: {} } },
    user: { providers: { openai: { baseURL: 'https://example.test/v1', api: 'openai-completions', models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }] }, 'my-gateway': { displayName: 'Mine', api: 'anthropic-messages' } } },
  }]
  const rows = addedRows(catalog, documents)
  assert.deepEqual(rows.map(row => row.provider), ['my-gateway', 'openai'])
  assert.equal(rows[0]?.displayName, 'Mine')
  assert.equal(rows[1]?.baseURL, 'https://example.test/v1')
  assert.equal(matchProvider(catalog, 'OpenAI')?.provider, 'openai')
  assert.equal(providerRoute('my-gateway'), 'my-gateway')
  assert.equal(providerRoute('My Gateway'), undefined)
  assert.equal(draftError({ route: 'my-gateway', displayName: 'Mine', baseURL: '', protocol: '', models: [], withKey: false }, false), 'protocol')
  assert.equal(draftError({ route: 'openai', displayName: 'OpenAI', baseURL: '', protocol: '', models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }], withKey: false }, true), undefined)
  assert.deepEqual(createOps(
    { route: 'my-gateway', displayName: 'Mine', baseURL: 'https://example.test/v1', protocol: 'openai', models: [{ id: 'm', name: 'M' }], withKey: true },
    { provider: 'my-gateway', displayName: 'Mine', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'my-gateway'] },
  ), [{
    op: 'set',
    path: ['providers', 'my-gateway'],
    value: { models: [{ id: 'm', name: 'M' }], displayName: 'Mine', baseURL: 'https://example.test/v1', api: 'openai-completions', apiKeyEnv: 'MY_GATEWAY_API_KEY' },
  }])
})

test('a stored wire protocol becomes one of the two choices', () => {
  assert.equal(protocolChoice('openai-completions'), 'openai')
  assert.equal(protocolChoice('openai-responses'), 'openai')
  assert.equal(protocolChoice('anthropic-messages'), 'anthropic')
  assert.equal(protocolChoice(undefined), '')
  assert.equal(protocolWire('openai'), 'openai-completions')
  assert.equal(protocolWire('anthropic'), 'anthropic-messages')
  assert.equal(protocolWire(''), undefined)
})

test('profile models keep their id and name', () => {
  assert.deepEqual(listedModels({ models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }, 'gpt-4.1'] }), [
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    { id: 'gpt-4.1', name: 'gpt-4.1' },
  ])
  assert.deepEqual(listedModels({}), [])
})

test('each api route is one row and an empty field clears the override', () => {
  const rows = modelRows(
    [
      { provider: 'deepseek-account', displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] },
      { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], defaultBaseURL: 'https://api.openai.com/v1' },
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], defaultBaseURL: 'https://api.deepseek.com' },
    ],
    [
      { ns: 'llm-pi-ai', revision: 4, value: { providers: { openai: { baseURL: 'https://example.test/v1', api: 'anthropic-messages', models: [{ id: 'a', name: 'A' }] } } } },
      { ns: 'llm-deepseek', revision: 2, value: { models: [{ id: 'deepseek-flash', name: 'Flash' }] } },
    ],
  )
  assert.deepEqual(rows.map(row => row.provider), ['deepseek-official', 'openai'])
  assert.equal(rows[1]?.baseURL, 'https://example.test/v1')
  assert.equal(rows[1]?.protocol, 'anthropic')
  assert.equal(rows[1]?.protocolEditable, true)
  assert.equal(rows[1]?.credentialRef, 'OPENAI_API_KEY')
  assert.deepEqual(rows[1]?.models, [{ id: 'a', name: 'A' }])
  assert.equal(rows[0]?.protocolEditable, false)
  assert.equal(rows[0]?.defaultBaseURL, 'https://api.deepseek.com')
  assert.deepEqual(fieldOp(['providers', 'openai'], 'baseURL', '  '), { op: 'unset', path: ['providers', 'openai', 'baseURL'] })
  assert.deepEqual(fieldOp(['providers', 'openai'], 'api', 'openai-completions'), { op: 'set', path: ['providers', 'openai', 'api'], value: 'openai-completions' })
  assert.deepEqual(toggleAllModels(['a', 'b'], ['c'], true), ['c', 'a', 'b'])
  assert.deepEqual(toggleAllModels(['a', 'b'], ['a', 'c'], false), ['c'])
  const directory = [
    { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    { provider: 'openrouter', displayName: 'OpenRouter', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openrouter'] },
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
  ]
  assert.equal(resolveProvider(directory, 'DeepSeek')?.provider, 'deepseek-official')
  assert.equal(resolveProvider(directory, 'seek')?.provider, 'deepseek-official')
  assert.equal(resolveProvider(directory, 'open'), undefined)
  assert.deepEqual(providerChoices(directory, 'open').map(item => item.provider), ['openai', 'openrouter'])
  assert.equal(missingDiscovery('no model discovery is registered for "llm-deepseek"'), true)
  assert.deepEqual(storedModels(
    [{ ns: 'llm-deepseek', revision: 1, value: { models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] } }],
    directory[2]!,
  ), [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }])
  assert.equal(providerBaseURL(directory[2]!, []), 'https://api.deepseek.com/anthropic')
  assert.equal(providerBaseURL(directory[2]!, [{ ns: 'llm-deepseek', revision: 1, value: { baseURL: 'https://example.test' } }]), 'https://example.test')
  assert.equal(providerBaseURL({ ...directory[0]!, defaultBaseURL: 'https://api.openai.com/v1' }, []), 'https://api.openai.com/v1')
})
