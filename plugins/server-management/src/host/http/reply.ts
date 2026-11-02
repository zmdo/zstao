import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError } from '../errors.ts'

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

export function cookieHeader(request: IncomingMessage): string {
  const value = request.headers.cookie
  return Array.isArray(value) ? value.join('; ') : (value ?? '')
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 256 * 1024) throw new HttpError(400, 'invalid_request')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
