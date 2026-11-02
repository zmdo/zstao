import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer, type Socket } from 'node:net'
import test from 'node:test'
import type { Connection } from 'ssh2'
import { SecretsCodec } from '../../database/src/fernet.ts'
import {builtinCatalog} from '../src/host/definitions/catalog.ts'
import { Enrollment } from '../src/host/servers/enrollment.ts'
import {DefinitionRegistry} from '../src/host/definitions/registry.ts'
import {connectSsh,FingerprintMismatch,SshError} from '../src/host/remote/ssh.ts'
import type { Db } from '../src/host/database/connection.ts'

const { Server, utils } = createRequire(import.meta.url)('ssh2') as typeof import('ssh2')
const privateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey
const parsed = utils.parseKey(privateKey)
if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Invalid fixture key')
const signingKey = parsed

async function sshFixture(
  t: test.TestContext,
  options: { delayMs?: number; stall?: boolean; reject?: boolean } = {},
) {
  const connections = new Set<Connection>(), timers = new Set<ReturnType<typeof setTimeout>>()
  let signed = false
  const server = new Server({ hostKeys: [privateKey] }, (connection) => {
    connections.add(connection)
    // Clients deliberately disconnect during timeout and fingerprint tests.
    connection.on('error', () => {})
    connection.on('close', () => connections.delete(connection))
    connection.on('authentication', (ctx) => {
      if (ctx.method !== 'publickey' || !ctx.key.data.equals(signingKey.getPublicSSH()))
        return ctx.reject(['publickey'])
      if (!ctx.signature) return ctx.accept()
      if (!ctx.blob || signingKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) return ctx.reject(['publickey'])
      signed = true
      if (options.reject) return ctx.reject(['publickey'])
      if (options.stall) return
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (connections.has(connection)) ctx.accept()
      }, options.delayMs ?? 0)
      timers.add(timer)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer)
    for (const connection of connections) connection.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    input: {
      host: '127.0.0.1', port: address.port, username: 'fixture',
      authMethod: 'private_key', secret: privateKey, expectedFingerprint: null,
    },
    get signed() { return signed },
  }
}

test('saved RSA key authenticates when the server takes longer than the former eight-second limit', { timeout: 20_000 }, async (t) => {
  const target = await sshFixture(t, { delayMs: 9000 })
  const secrets = new SecretsCodec(randomBytes(32)), id = randomUUID()
  const db: Db = {
    async query<T>(sql: string, values?: unknown[]) {
      assert.match(sql, /^select secret_ciphertext from ssh_keys/)
      assert.equal(values?.[0], id)
      return { rows: [{ secret_ciphertext: secrets.encrypt(privateKey) }] as T[] }
    },
    async connect() { throw new Error('Connection test must not write data') },
  }
  const definitions = new DefinitionRegistry(db, builtinCatalog())
  const enrollment = new Enrollment({ db, definitions, secrets })
  t.after(async () => { await enrollment.close(); await definitions.close() })
  const result = await enrollment.test({
    host: target.input.host, ssh_port: target.input.port, ssh_user: target.input.username,
    auth_method: 'private_key', ssh_key_id: id,
  })
  assert.equal(result.ok, true)
  assert.equal(target.signed, true)
  assert.match(result.fingerprint, /^SHA256:/)
})

test('a configured deadline reports authentication timeout after a completed handshake', { timeout: 5000 }, async (t) => {
  const target = await sshFixture(t, { stall: true })
  await assert.rejects(connectSsh({ ...target.input, readyTimeoutMs: 1000 }), (error) => {
    assert.ok(error instanceof SshError)
    assert.equal(error.code, 'ssh_auth_timeout')
    assert.equal(error.params.seconds, 1)
    assert.ok(error.fingerprint)
    assert.ok(error.cause instanceof Error)
    return true
  })
  assert.equal(target.signed, true)
})

async function silentFixture(t: test.TestContext, closeAfterHeader = false) {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    // The client aborts this deliberately incomplete handshake.
    socket.on('error', () => {})
    if (closeAfterHeader) socket.end('SSH-2.0-fixture\r\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    host: '127.0.0.1', port: address.port, username: 'fixture',
    authMethod: 'private_key', secret: privateKey, expectedFingerprint: null,
  }
}

test('an accepted TCP connection without SSH handshake reports handshake timeout', { timeout: 5000 }, async (t) => {
  const input = await silentFixture(t)
  await assert.rejects(connectSsh({ ...input, readyTimeoutMs: 250 }), (error) => {
    assert.ok(error instanceof SshError)
    assert.equal(error.code, 'ssh_handshake_timeout')
    assert.equal(error.params.seconds, 0.25)
    assert.equal(error.fingerprint, undefined)
    return true
  })
})

test('closing after the SSH banner rejects instead of leaving the connection promise pending', { timeout: 5000 }, async (t) => {
  const input = await silentFixture(t, true)
  await assert.rejects(connectSsh(input), (error) => error instanceof SshError && error.code === 'ssh_closed')
})

test('server rejection remains authentication failure rather than timeout', { timeout: 5000 }, async (t) => {
  const target = await sshFixture(t, { reject: true })
  await assert.rejects(connectSsh(target.input), (error) => error instanceof SshError && error.code === 'ssh_auth_failed')
})

test('a longer connection deadline still enforces the expected host fingerprint', { timeout: 5000 }, async (t) => {
  const target = await sshFixture(t)
  await assert.rejects(
    connectSsh({ ...target.input, expectedFingerprint: 'SHA256:different' }),
    (error) => error instanceof FingerprintMismatch,
  )
  assert.equal(target.signed, false)
})
