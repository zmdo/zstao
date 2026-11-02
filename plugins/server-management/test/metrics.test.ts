import assert from 'node:assert/strict'
import test from 'node:test'
import {startMetrics} from '../src/host/servers/metrics.ts'
import {type SshSession} from '../src/host/remote/ssh.ts'
import type { Db } from '../src/host/database/connection.ts'

test('unloading while metrics SSH is opening closes the late connection and does not sample', { timeout: 5000 }, async () => {
  const opening = Promise.withResolvers<void>()
  const connected = Promise.withResolvers<SshSession>()
  let closed = 0
  let sampled = 0
  const db: Db = {
    async query(sql) {
      if (sql.startsWith('select s.id from')) return { rows: [{ id: 'server' }] as never[] }
      return { rows: [{ id: 'server', host: 'localhost', ssh_port: 22, ssh_user: 'test', auth_method: 'password', secret_ciphertext: 'test', host_fingerprint: null, config_revision:1,observed_config_revision:1,environment_revision:1,os_probe_state:'detected',declared_os:{kind:'catalog',family:'builtin/ubuntu',version:'24.04',precision:'release'},detected_os:{family:'builtin/ubuntu',version:'24.04',architecture:'x86_64'} }] as never[] }
    },
    async connect() { throw new Error('No transaction expected') },
  }
  const stop = startMetrics(db, { decrypt: value => value }, 1, error => { throw error }, async () => { opening.resolve(); return connected.promise })
  await opening.promise
  const stopping = stop()
  connected.resolve({ fingerprint: 'test', close() { closed++ }, async exec() { sampled++; throw new Error('No sample expected') }, async putScript() {}, async shell() { throw new Error('No shell expected') } })
  await stopping
  assert.equal(closed, 1)
  assert.equal(sampled, 0)
})
