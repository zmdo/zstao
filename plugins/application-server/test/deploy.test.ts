import assert from 'node:assert/strict'
import test from 'node:test'
import { managedDeploy, ciClient } from '../../../scripts/deploy-managed-image.mjs'
const receipt = { revision: 1, generation: 'a' }
test('stale receipt is repaired once; repeated failures never loop', async () => {
  let prepared = 0, executions = 0
  const result = await managedDeploy({ prepare: async () => ({ ...receipt, revision: ++prepared }), execute: async () => ++executions === 1 ? { error: 'credential_receipt_stale' } : { pulled: true } })
  assert.equal(result.pulled, true); assert.equal(prepared, 2); assert.equal(executions, 2)
  prepared = 0
  await assert.rejects(managedDeploy({ prepare: async () => ({ ...receipt, revision: ++prepared }), execute: async () => ({ error: 'credential_receipt_stale' }) }))
  assert.equal(prepared, 2)
})
test('auth failure retries only after version or generation changed; image/network errors never reprepare', async () => {
  for (const error of ['registry_auth_failed', 'image_pull_failed', 'registry_permission_denied']) {
    let prepared = 0, executions = 0
    await assert.rejects(managedDeploy({ prepare: async () => { prepared++; return receipt }, execute: async () => { executions++; return { error } } }), new RegExp(error))
    assert.equal(executions, 1); assert.equal(prepared, error === 'registry_auth_failed' ? 2 : 1)
  }
})
test('CI uses bearer authentication, waits for tasks and only receives public receipt', async () => {
  const calls: { path: string; init: RequestInit }[] = []
  const client = ciClient({ baseUrl: 'https://ces.example', token: 'ces_'+'a'.repeat(43), serverId: 'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12), image: 'registry.example/team/app@sha256:'+'a'.repeat(64), delay: async () => {},
    fetcher: async (url: URL, init: RequestInit) => { calls.push({ path: url.pathname, init }); return new Response(JSON.stringify(url.pathname.endsWith('/prepare') ? { state: 'queued' } : { state: 'succeeded', result: { receipt } })) } })
  assert.deepEqual(await client.prepare(), receipt)
  assert.equal(calls.length, 2); assert.equal(calls[0]!.init.redirect, 'error')
  assert.throws(() => ciClient({ baseUrl: 'http://public.example', token: '', serverId: '', image: '' }), /ces_https_required/)
})
