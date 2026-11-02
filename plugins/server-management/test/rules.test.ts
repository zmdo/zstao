import assert from 'node:assert/strict'
import test from 'node:test'
import {keyInUse,retestAfterEdit,shouldRetest,type RetestSnap} from '../src/host/servers/rules.ts'
import { omitSecrets } from '../src/host/servers/service.ts'
import {parseSample} from '../src/host/remote/parse.ts'
import {chosenRegion,privatePlace} from '../src/host/servers/region.ts'

test('a metric sample clamps cpu and disk', () => {
  const sample = parseSample('2 100 80 200 100 1024 512 1000 1200')
  assert.equal(sample.cpuCores, 2)
  assert.equal(sample.cpuPercent, 80)
  assert.equal(sample.memTotalBytes, 1024 * 1024)
  assert.equal(sample.diskUsedBytes, 1000)
  assert.equal(parseSample('2 100 80 200 100 1024 512 1000 1200\nAMD EPYC').cpuModel, 'AMD EPYC')
})

test('a written region wins and a private address is local', () => {
  assert.equal(chosenRegion('10.0.0.1', '机房', '内网'), '机房')
  assert.equal(privatePlace('10.1.2.3'), '内网')
  assert.equal(privatePlace('8.8.8.8'), undefined)
  assert.throws(() => chosenRegion('10.0.0.1', 'x'.repeat(81), null))
})

test('a busy key and a quiet connection change stay put', () => {
  assert.equal(keyInUse(2), true)
  assert.equal(keyInUse(0), false)
  assert.equal(shouldRetest({ autoInstall: false, connectionChanged: true, selectionChanged: false }), false)
  assert.equal(shouldRetest({ autoInstall: true, connectionChanged: false, selectionChanged: true }), true)
  const saved: RetestSnap = {
    autoInstall: true,
    host: '10.0.0.1',
    port: 22,
    user: 'root',
    method: 'private_key',
    keyId: 'k',
    selection: '["docker"]',
    secretWritten: false,
  }
  assert.equal(retestAfterEdit(saved, saved), false)
  assert.equal(retestAfterEdit(saved, { ...saved, host: '10.0.0.2' }), true)
  assert.equal(retestAfterEdit({ ...saved, autoInstall: false }, { ...saved, autoInstall: false, host: '10.0.0.2' }), false)
})

test('a server response drops the stored secret', () => {
  const visible = omitSecrets({ id: 's', name: 'web', secret_ciphertext: 'cipher', secret: 'plain' })
  assert.equal('secret_ciphertext' in visible, false)
  assert.equal('secret' in visible, false)
  assert.equal(visible.name, 'web')
})
