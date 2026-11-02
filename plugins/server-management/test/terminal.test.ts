import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { WebSocket } from 'ws'
import { terminalRoute } from '../src/host/remote/terminal.ts'
import type { connectSsh, ShellChannel, SshSession } from '../src/host/remote/ssh.ts'
import type { Db } from '../src/host/database/connection.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check: () => boolean, timeout = 2_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('condition timed out')
    await sleep(10)
  }
}

function fixture() {
  let resolveConnect: (() => void) | undefined
  let shell: ShellChannel | undefined
  let shellCreated = 0
  let sshClosed = 0
  let shellClosed = 0
  let connections = 0
  const server = {
    id: randomUUID(),
    host: '127.0.0.1',
    ssh_port: 22,
    ssh_user: 'test',
    auth_method: 'password',
    secret_ciphertext: 'ciphertext',
    host_fingerprint: null,
    install_required_software: false,
    declared_os: {},
    detected_os: null,
    os_probe_state: 'unknown',
    observed_config_revision: 0,
    environment_revision: 0,
    group_id: null,
    type_key: 'builtin/vacant',
    config_revision: '1',
  }
  const ssh: SshSession = {
    fingerprint: 'SHA256:test',
    async exec() {
      return { code: 0, stdout: '', stderr: '' }
    },
    async putScript() {},
    async shell() {
      shellCreated += 1
      shell = {
        write() {},
        resize() {},
        onData() {},
        onClose() {},
        close() {
          shellClosed += 1
        },
      }
      return shell
    },
    close() {
      sshClosed += 1
    },
  }
  const connect = (async () => {
    connections += 1
    await new Promise<void>((resolve) => {
      resolveConnect = resolve
    })
    return ssh
  }) as typeof connectSsh
  const db = {
    query: async () => ({ rows: [server] }),
  } as unknown as Db
  const route = terminalRoute(
    db,
    { decrypt: () => 'secret' },
    { read: async () => ({ username: 'test' }) },
    connect,
  )
  return {
    server,
    route,
    get resolveConnect() {
      return resolveConnect
    },
    get shell() {
      return shell
    },
    get shellCreated() {
      return shellCreated
    },
    get sshClosed() {
      return sshClosed
    },
    get shellClosed() {
      return shellClosed
    },
    get connections() {
      return connections
    },
  }
}

async function withRoute(run: (context: ReturnType<typeof fixture>, port: number) => Promise<void>) {
  const context = fixture()
  const http = createServer()
  http.on('upgrade', (request, socket, head) => {
    void context.route.handler(request, socket, head)
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  assert.ok(address && typeof address !== 'string')
  try {
    await run(context, address.port)
  } finally {
    await context.route.close()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
}

test('a client leaving while SSH is connecting closes the late session', async () => {
  await withRoute(async (context, port) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?id=${context.server.id}`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    await until(() => context.resolveConnect !== undefined)
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    socket.close()
    await closed
    context.resolveConnect?.()
    await sleep(50)
    assert.equal(context.connections, 1)
    assert.equal(context.shellCreated, 0)
    assert.equal(context.sshClosed, 1)
  })
})

test('a client leaving after the shell starts closes the shell and SSH session', async () => {
  await withRoute(async (context, port) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?id=${context.server.id}`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    await until(() => context.resolveConnect !== undefined)
    context.resolveConnect?.()
    await until(() => context.shell !== undefined)
    socket.close()
    await sleep(50)
    assert.equal(context.connections, 1)
    assert.equal(context.shellCreated, 1)
    assert.ok(context.shellClosed >= 1)
    assert.ok(context.sshClosed >= 1)
  })
})
