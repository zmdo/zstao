import assert from 'node:assert/strict'
import test from 'node:test'
import { checkZone } from '../src/cloudflare.ts'

type Route = (url: string, init: RequestInit) => { status: number; body: unknown }

function fakeFetch(route: Route): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const result = route(url, init)
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

const verifyOk = { status: 200, body: { success: true, result: { status: 'active' } } }
const zonesOk = {
  status: 200,
  body: { success: true, result: [{ id: 'zone-1', name: 'example.com', account: { name: 'Acme' } }] },
}
const readOk = { status: 200, body: { success: true, result: [] } }
const probeRejected = { status: 400, body: { success: false, errors: [{ code: 9003, message: 'invalid type' }] } }

test('checkZone passes a token that can read and edit DNS', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.endsWith('/user/tokens/verify')) return verifyOk
    if (url.includes('/zones?name=')) return zonesOk
    if (url.includes('/dns_records?per_page=1')) return readOk
    return probeRejected
  })
  const result = await checkZone('token', 'example.com', { fetch: fetchImpl })
  assert.deepEqual(result, {
    ok: true,
    zone: { id: 'zone-1', name: 'example.com', accountName: 'Acme' },
  })
})

test('checkZone reports rejected tokens, missing zones and missing permissions', async () => {
  const unauthorized = await checkZone('t', 'example.com', {
    fetch: fakeFetch(() => ({ status: 401, body: { success: false, errors: [{ message: 'bad token' }] } })),
  })
  assert.equal(unauthorized.ok, false)
  assert.equal(unauthorized.ok === false && unauthorized.code, 'unauthorized')

  const missingZone = await checkZone('t', 'example.com', {
    fetch: fakeFetch((url) => {
      if (url.endsWith('/user/tokens/verify')) return verifyOk
      return { status: 200, body: { success: true, result: [{ id: 'z', name: 'other.com' }] } }
    }),
  })
  assert.equal(missingZone.ok === false && missingZone.code, 'zone_not_found')

  const readForbidden = await checkZone('t', 'example.com', {
    fetch: fakeFetch((url) => {
      if (url.endsWith('/user/tokens/verify')) return verifyOk
      if (url.includes('/zones?name=')) return zonesOk
      return { status: 403, body: { success: false, errors: [{ message: 'forbidden' }] } }
    }),
  })
  assert.equal(readForbidden.ok === false && readForbidden.code, 'dns_read_forbidden')

  const writeForbidden = await checkZone('t', 'example.com', {
    fetch: fakeFetch((url, init) => {
      if (url.endsWith('/user/tokens/verify')) return verifyOk
      if (url.includes('/zones?name=')) return zonesOk
      if (init.method === 'POST') return { status: 403, body: { success: false, errors: [{ message: 'no dns edit' }] } }
      return readOk
    }),
  })
  assert.equal(writeForbidden.ok === false && writeForbidden.code, 'dns_write_forbidden')
})

test('checkZone never treats a network failure as success', async () => {
  const result = await checkZone('t', 'example.com', {
    fetch: (() => {
      throw new Error('offline')
    }) as typeof fetch,
  })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.code, 'network')
})
