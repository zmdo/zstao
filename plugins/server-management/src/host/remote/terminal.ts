import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { ServerError, type ErrorCode } from '../../shared/errors.ts'
import { errorPayload } from '../../shared/i18n.ts'
import { type Db } from '../database/connection.ts'
import { serverSecret } from '../servers/persistence/credential-repository.ts'
import { connectSsh, type ShellChannel, type SshSession } from './ssh.ts'

interface Secrets {
  decrypt(ciphertext: string): string
}

interface SessionService {
  read(cookieHeader: string): Promise<unknown>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Exact upgrade path. The server id is the `id` query. Closing the socket closes SSH. */
export function terminalRoute(
  db: Db,
  secrets: Secrets,
  session: SessionService,
  connect: typeof connectSsh = connectSsh,
): {
  handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>
  close: () => Promise<void>
} {
  const wss = new WebSocketServer({ noServer: true })
  const open = new Set<SshSession>()
  const pending = new Set<Promise<void>>()
  let closing = false
  return {
    handler: async (request, socket, head) => {
      const header = request.headers.cookie
      const cookie = Array.isArray(header) ? header.join('; ') : (header ?? '')
      if ((await session.read(cookie)) === undefined) {
        refuse(socket, 401, 'unauthorized')
        return
      }
      const id = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('id') ?? ''
      if (!UUID.test(id)) {
        refuse(socket, 404, 'server_not_found')
        return
      }
      const server = await serverSecret(db, id)
      if (server === undefined) {
        refuse(socket, 404, 'server_not_found')
        return
      }
      if (closing) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const task = attach(server, ws)
          .catch(() => {
            ws.close()
          })
          .finally(() => {
            pending.delete(task)
          })
        pending.add(task)
      })
    },
    close: async () => {
      if (closing) return
      closing = true
      for (const client of wss.clients) client.close()
      await Promise.allSettled([...pending])
      // Pending attaches close themselves through their socket handler; this is the fallback.
      for (const item of open) item.close()
      open.clear()
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve()
        })
      })
    },
  }

  async function attach(server: NonNullable<Awaited<ReturnType<typeof serverSecret>>>, ws: WebSocket): Promise<void> {
    let secret = ''
    try {
      secret = secrets.decrypt(server.secret_ciphertext)
    } catch (cause) {
      void cause
      ws.close()
      return
    }
    let ssh: SshSession | undefined
    let shell: ShellChannel | undefined
    let closed = false
    const shutdown = () => {
      closed = true
      // Clear both handles before closing so a shell close callback cannot close them twice.
      const channel = shell
      shell = undefined
      const session = ssh
      ssh = undefined
      channel?.close()
      session?.close()
      if (session !== undefined) open.delete(session)
    }
    // Register before the first await so a client that leaves while SSH is connecting cannot leak it.
    ws.on('close', shutdown)
    try {
      if (ws.readyState !== WebSocket.OPEN) return
      ssh = await connect({
        host: server.host,
        port: server.ssh_port,
        username: server.ssh_user,
        authMethod: server.auth_method,
        secret,
        expectedFingerprint: server.host_fingerprint,
      })
      if (closed || ws.readyState !== WebSocket.OPEN) {
        shutdown()
        return
      }
      open.add(ssh)
      shell = await ssh.shell(80, 24)
      if (closed || ws.readyState !== WebSocket.OPEN) {
        shutdown()
        return
      }
      shell.onData((chunk) => {
        if (ws.readyState !== WebSocket.OPEN) return
        try {
          ws.send(chunk)
        } catch (cause) {
          void cause
          shutdown()
        }
      })
      shell.onClose(() => {
        shutdown()
        ws.close()
      })
      ws.on('message', (data) => {
        if (!closed && shell !== undefined) onMessage(shell, data)
      })
    } catch (cause) {
      shutdown()
      throw cause
    }
  }
}

function onMessage(shell: ShellChannel, data: RawData): void {
  const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
  const resize = readResize(buffer.toString('utf8'))
  if (resize === 'ignore') return
  if (resize !== undefined) {
    shell.resize(resize.cols, resize.rows)
    return
  }
  shell.write(buffer)
}

function readResize(text: string): { cols: number; rows: number } | 'ignore' | undefined {
  if (!text.startsWith('{')) return undefined
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch (cause) {
    void cause
    return undefined
  }
  if (payload === null || typeof payload !== 'object') return undefined
  const record = payload as { type?: unknown; cols?: unknown; rows?: unknown }
  if (record.type !== 'resize') return undefined
  const cols = Number(record.cols)
  const rows = Number(record.rows)
  if (!Number.isInteger(cols) || cols < 20 || cols > 300) return 'ignore'
  if (!Number.isInteger(rows) || rows < 5 || rows > 120) return 'ignore'
  return { cols, rows }
}

function refuse(socket: Duplex, status: number, code: ErrorCode): void {
  const body = JSON.stringify(errorPayload(new ServerError(code)))
  const reason = status === 401 ? 'Unauthorized' : 'Not Found'
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
  )
  socket.destroy()
}
