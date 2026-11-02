import * as queries from './persistence/repository.ts'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { transaction } from '../database/transaction.ts'
import { account, audit, keySnapshot } from './persistence/repository.ts'
import type { AdminDeps } from './model.ts'
import { AdminError, uuid } from './model.ts'
import { digest } from '../recipes/canonical.ts'
import { downloadLocale, keyDownloadPage } from './download-copy.ts'
export async function downloadRoute(
  deps: AdminDeps,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new AdminError('cancelled')
  const abort = () => req.destroy()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await download(deps, req, res, id)
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
async function download(deps: AdminDeps, req: IncomingMessage, res: ServerResponse, id: string) {
  uuid(id)
  if (req.method !== 'GET' && req.method !== 'POST') throw new AdminError('invalid_request')
  const row = (
    await queries.readDownload<{
      kind: string
      target_id: string
      content: string | null
      fingerprint: string
      csrf: string | null
    }>(deps.db, [id])
  ).rows[0]
  if (!row) throw new AdminError('download_expired')
  if (row.kind === 'key' && req.method === 'GET') {
    const snapshot = await keySnapshot(deps.db, row.target_id)
    if (snapshot.fingerprint !== row.fingerprint) throw new AdminError('key_changed')
    const token = randomBytes(32).toString('hex')
    const nonce = randomBytes(16).toString('hex')
    const locale = downloadLocale(deps.localePreference?.(), req.headers['accept-language'])
    await queries.setDownloadChallenge(deps.db, [
      id,
      createHash('sha256')
        .update(token + digest(snapshot))
        .digest('hex'),
    ])
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'`,
      'referrer-policy': 'no-referrer',
      'content-language': locale,
      'x-content-type-options': 'nosniff',
    })
    res.end(
      keyDownloadPage(locale, { name: String(snapshot.name), fingerprint: String(snapshot.fingerprint), servers: snapshot.servers as { name: string; host: string }[] }, token, nonce),
    )
    return
  }
  let token = ''
  if (row.kind === 'key') {
    if (req.method !== 'POST' || req.headers['sec-fetch-site'] === 'cross-site')
      throw new AdminError('unauthorized')
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of req) {
      length += chunk.length
      if (length > 2048) throw new AdminError('invalid_request')
      chunks.push(Buffer.from(chunk))
    }
    token = new URLSearchParams(Buffer.concat(chunks).toString()).get('token') ?? ''
    if (!/^[a-f0-9]{64}$/.test(token)) throw new AdminError('unauthorized')
  }
  const content = await transaction(deps.db, async (db) => {
    const ticket = (await queries.lockDownload<typeof row>(db, [id])).rows[0]
    if (!ticket) throw new AdminError('download_expired')
    let result = ticket.content ?? ''
    if (ticket.kind === 'key') {
      const snapshot = await keySnapshot(db, ticket.target_id, true)
      if (
        ticket.csrf !==
        createHash('sha256')
          .update(token + digest(snapshot))
          .digest('hex')
      )
        throw new AdminError('approval_snapshot_changed')
      const key = (await queries.keySecret<{ secret_ciphertext: string }>(db, [ticket.target_id]))
        .rows[0]!
      result = deps.secrets.decrypt(key.secret_ciphertext)
      await audit(db, {
        tool: 'platform_server_key_admin',
        action: 'reveal',
        target: ticket.target_id,
        after: { fingerprint: ticket.fingerprint },
        actor: await account(db),
        context: { callId: randomUUID(), signal: new AbortController().signal, source: 'web' },
        approval: 'approved',
        status: 'succeeded',
      })
    }
    await queries.consumeDownload(db, [id])
    return result
  })
  res.writeHead(200, {
    'content-type': row.kind === 'key' ? 'application/octet-stream' : 'application/json',
    'content-disposition': `attachment; filename="${row.kind === 'key' ? 'ssh-private-key' : 'server-audit'}.txt"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(content)
}
