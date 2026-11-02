import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseDeclaredOs,
  sameDeclaredOs,
  osVerification,
  supportsOs,
  type OsSupport,
} from '../src/shared/operating-systems.ts'
import {parseLinuxOs,parseWindowsOs} from '../src/host/remote/os-probe.ts'

test('catalog identities ignore forged version values, while custom names never imply support', () => {
  const ubuntu=parseDeclaredOs({kind:'catalog',family:'builtin/ubuntu',releaseKey:'24.04',version:'99.99'})
  assert.equal(ubuntu.kind==='catalog' && ubuntu.version,'24.04')
  const custom=parseDeclaredOs({kind:'custom',text:' Ubuntu 24.04 '})
  assert.deepEqual(custom,{kind:'custom',text:'Ubuntu 24.04'})
  assert.equal(supportsOs({kind:'explicit',selectors:[{family:'builtin/ubuntu',versions:{kind:'any'}}]},custom),false)
  assert.throws(()=>parseDeclaredOs({kind:'custom',text:' '}))
})

test('system family, version precision and numeric ranges are checked separately', () => {
  const debian=parseDeclaredOs({kind:'catalog',family:'builtin/debian',releaseKey:'12'})
  const custom=parseDeclaredOs({kind:'custom',text:'Ubuntu 24.04'})
  assert.equal(osVerification(debian,{family:'builtin/debian',version:'12.10',architecture:'x86_64'},'detected'),'matched')
  assert.equal(osVerification(debian,{family:'builtin/ubuntu',version:'12',architecture:'x86_64'},'detected'),'mismatch')
  assert.equal(osVerification(debian,{family:'builtin/debian',version:'12',architecture:'x86_64'},'failed'),'unverified')
  assert.equal(osVerification(custom,{family:'builtin/ubuntu',version:'24.04',architecture:'x86_64'},'detected'),'custom')
  const support:OsSupport={kind:'explicit',selectors:[{family:'builtin/debian',versions:{kind:'range',minimum:'12.9',maximum:'12.11'},architectures:['x86_64']}]}
  assert.equal(supportsOs(support,debian),true)
  assert.equal(supportsOs(support,{family:'builtin/debian',version:'12.10',architecture:'x86_64'}),true)
  assert.equal(supportsOs(support,{family:'builtin/debian',version:'12.8',architecture:'x86_64'}),false)
  assert.equal(supportsOs(support,{family:'builtin/debian',version:'12.10',architecture:'s390x'}),false)
})

test('removed catalog items retain their saved identity; translations and JSON key order are not configuration changes', () => {
  const old={kind:'catalog' as const,family:'builtin/ubuntu',releaseKey:'18.04',version:'18.04',precision:'release' as const,name:'Ubuntu 18.04 LTS'}
  assert.throws(()=>parseDeclaredOs(old))
  assert.deepEqual(parseDeclaredOs(old,old),old)
  assert.equal(sameDeclaredOs(old,{name:'Changed label',precision:'release',version:'18.04',releaseKey:'18.04',family:'builtin/ubuntu',kind:'catalog'}),true)
})

test('OS probes parse facts without sourcing shell content or equating Windows client editions with Server', () => {
  assert.deepEqual(parseLinuxOs('ID="ubuntu"\nVERSION_ID="24.04"\nSMP_ARCH=x86_64\n'),{family:'builtin/ubuntu',version:'24.04',architecture:'x86_64'})
  assert.equal(parseLinuxOs('ID=$(false)\nVERSION_ID=24.04\nSMP_ARCH=x86_64'),null)
  assert.equal(parseWindowsOs('{"caption":"Microsoft Windows 11 Pro","architecture":"64-bit"}'),null)
  assert.equal(parseWindowsOs('{"caption":"Microsoft Windows Server 2025 Standard","architecture":"64-bit"}')?.version,'2025')
})
