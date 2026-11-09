#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const repairable = new Set(['configuration_changed', 'credential_receipt_stale', 'credential_config_missing', 'registry_auth_failed'])
export async function managedDeploy({ prepare, execute, report = async () => {} }) {
  let receipt = await prepare()
  for (let attempt = 0; ; attempt++) {
    const result = await execute(receipt)
    if (!result.error) { await report(result); return result }
    if (attempt === 0 && repairable.has(result.error)) {
      const next = await prepare()
      if (result.error !== 'registry_auth_failed' || next.revision !== receipt.revision || next.generation !== receipt.generation) {
        receipt = next; continue
      }
    }
    await report(result)
    throw new Error(result.error)
  }
}
export function ciClient({ baseUrl, token, serverId, image, credentialId = 'platform-pull', fetcher = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('ces_https_required')
  if (base.username || base.password || base.search || base.hash || !/^ces_[a-zA-Z0-9_-]{43}$/.test(token)) throw new Error('invalid_ces_configuration')
  if (!/^[a-f0-9-]{36}$/.test(serverId) || !/^[a-z0-9.:-]+\/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('invalid_deployment_target')
  let requestId
  const request = async (path, value) => {
    const response = await fetcher(new URL('/console-api/application-registry' + path, base), {
      method: value ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, ...(value ? { 'content-type': 'application/json' } : {}) },
      ...(value ? { body: JSON.stringify(value) } : {}),
    })
    // Upstream error bodies are never printed; they may contain a proxy's request dump.
    if (!response.ok) { await response.body?.cancel(); throw new Error(`ces_request_failed_${response.status}`) }
    return response.json()
  }
  return {
    async prepare() {
      requestId = randomUUID()
      await request('/prepare', { serverId, image, credentialId, requestId })
      const deadline = Date.now() + 300_000
      while (Date.now() < deadline) {
        const task = await request('/requests/' + requestId)
        if (task.state === 'succeeded' && task.result?.receipt) return task.result.receipt
        if (['failed', 'blocked', 'cancelled'].includes(task.state)) throw new Error('credential_preparation_failed')
        await delay(1000)
      }
      throw new Error('credential_preparation_timeout')
    },
    async execute() {
      await request('/requests/' + requestId + '/deploy', {})
      const deadline = Date.now() + 1_260_000
      while (Date.now() < deadline) {
        const task = await request('/requests/' + requestId + '/deploy')
        if (task.state === 'succeeded') return task.result
        if (['failed','blocked','cancelled'].includes(task.state)) return task.result ?? { error: 'deployment_failed' }
        await delay(1000)
      }
      throw new Error('deployment_outcome_unknown')
    },
  }
}
export async function main(env = process.env) {
  const image = env.CES_DEPLOY_IMAGE
  const client = ciClient({ baseUrl: env.CES_URL, token: env.CES_REGISTRY_TOKEN, serverId: env.CES_SERVER_ID, image })
  const result = await managedDeploy(client)
  console.log(JSON.stringify({ pulled: result.pulled, deployed: result.deployed, image }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Managed deployment failed; check the credential task and deployment status in CES.'); process.exitCode = 1 })
}
