import assert from 'node:assert/strict'
import test from 'node:test'
import { credentialRef, deriveKeyRef, modelProfileRecords, valueAt } from '../src/profiles.ts'
import { replaceModelProfiles, type Queryable, type StoredModelProfile } from '../src/store.ts'
import { modelsTabLabel } from '../src/label.ts'

test('a provider profile keeps its named key and drops nothing else', () => {
  const records = modelProfileRecords(
    [{ provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-openai', settingsPath: ['providers', 'openai'] }],
    [{ ns: 'llm-openai', revision: 3, value: { providers: { openai: { baseURL: 'https://api.openai.com', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-4.1' } } } }],
  )
  assert.equal(records.length, 1)
  assert.equal(records[0]?.credentialRef, 'OPENAI_API_KEY')
  assert.deepEqual(records[0]?.config, { baseURL: 'https://api.openai.com', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-4.1' })
  assert.equal(records[0]?.revision, 3)
})

test('a route without a named key uses the derived reference', () => {
  assert.equal(deriveKeyRef('minimax-cn'), 'MINIMAX_CN_API_KEY')
  assert.equal(credentialRef('minimax-cn', { baseURL: 'https://api.minimaxi.com' }), 'MINIMAX_CN_API_KEY')
  assert.equal(credentialRef('deepseek-account', { signedIn: true }), undefined)
  assert.equal(valueAt({ providers: { a: { model: 'x' } } }, ['providers', 'missing']), undefined)
})

test('the models tab follows the active language', () => {
  assert.equal(modelsTabLabel('zh'), '模型')
  assert.equal(modelsTabLabel('en'), 'Models')
})

test('a failed write rolls the model table back', async () => {
  const calls: string[] = []
  const client: Queryable = {
    async query(sql) {
      calls.push(sql)
      if (sql.trimStart().startsWith('insert')) throw new Error('disk full')
    },
  }
  const row: StoredModelProfile = {
    provider: 'openai',
    settingsNs: 'llm-openai',
    settingsPath: [],
    displayName: 'OpenAI',
    config: { model: 'gpt-4.1' },
    credentialRef: 'OPENAI_API_KEY',
    credentialCiphertext: 'cipher',
    revision: 1,
  }
  await assert.rejects(() => replaceModelProfiles(client, [row]), /disk full/)
  assert.deepEqual(calls.map(sql => sql.trim().split(/\s+/)[0]), ['begin', 'delete', 'insert', 'rollback'])
})
