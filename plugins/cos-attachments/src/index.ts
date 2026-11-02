import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import COS from 'cos-nodejs-sdk-v5'
import { AttachmentError, type FileAttachmentRef, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import type { Context } from '@deepseek-ai/cordis'

interface BucketRow {
  bucket: string
  region: string
  secret_id: string
  secret_key_ciphertext: string
  base_prefix: string
  enabled: boolean
}

interface Secrets {
  decrypt(token: string): string
}

interface Settings {
  bucket: string
  region: string
  secretId: string
  secretKey: string
  prefix: string
}

const CACHE_MS = 3000

const shaOf = (ref: ImageAttachmentRef | FileAttachmentRef): string => String(ref.attachmentId).replace(/^sha256:/, '')

export default class CosAttachmentStore extends LocalAttachmentStore {
  static inject = ['database', 'secrets']

  private cached: { settings: Settings | undefined; at: number } | undefined

  constructor(ctx: Context, config: Record<string, unknown> = {}) {
    super(ctx, config)
  }

  private async settings(): Promise<Settings | undefined> {
    const now = Date.now()
    if (this.cached !== undefined && now - this.cached.at < CACHE_MS) return this.cached.settings
    let settings: Settings | undefined
    try {
      const ctx = this.ctx as unknown as {
        database: { pool: { query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> } }
        secrets: Secrets
      }
      const { rows } = await ctx.database.pool.query<BucketRow>(
        "select bucket, region, secret_id, secret_key_ciphertext, base_prefix, enabled from cos_buckets where role = 'attachments'",
      )
      const row = rows[0]
      if (row !== undefined && row.enabled && row.bucket !== '' && row.secret_id !== '') {
        settings = {
          bucket: row.bucket,
          region: row.region,
          secretId: row.secret_id,
          secretKey: ctx.secrets.decrypt(row.secret_key_ciphertext),
          prefix: row.base_prefix,
        }
      }
    } catch (cause) {
      this.ctx.logger?.warn?.('cos-attachments: configuration unavailable: %s', cause instanceof Error ? cause.message : String(cause))
    }
    this.cached = { settings, at: now }
    return settings
  }

  private client(settings: Settings): any {
    const cos = new COS({ SecretId: settings.secretId, SecretKey: settings.secretKey })
    return cos
  }

  private async upload(settings: Settings, key: string, body: Buffer, contentType: string): Promise<void> {
    const cos = this.client(settings)
    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        { Bucket: settings.bucket, Region: settings.region, Key: key, Body: body, ContentType: contentType },
        (error: unknown) => (error ? reject(error) : resolve()),
      )
    })
  }

  private async download(settings: Settings, key: string): Promise<Buffer> {
    const cos = this.client(settings)
    const data = await new Promise<any>((resolve, reject) => {
      cos.getObject({ Bucket: settings.bucket, Region: settings.region, Key: key }, (error: unknown, value: any) =>
        error ? reject(error) : resolve(value),
      )
    })
    return Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body)
  }

  private async pushImage(ref: ImageAttachmentRef): Promise<void> {
    const settings = await this.settings()
    if (settings === undefined) return
    const path = this.imageHostPath(ref)
    if (path === undefined) return
    const sha = shaOf(ref)
    try {
      await this.upload(settings, `${settings.prefix}objects/${sha.slice(0, 2)}/${sha}`, await readFile(path), 'image/png')
    } catch (cause) {
      throw new AttachmentError(
        `COS 闄勪欢鍐欏叆澶辫触锛?{cause instanceof Error ? cause.message : String(cause)}`,
        'ATTACHMENT_WRITE_FAILED',
        { cause },
      )
    }
  }

  private async pushFile(ref: FileAttachmentRef): Promise<void> {
    const settings = await this.settings()
    if (settings === undefined) return
    const path = this.fileHostPath(ref)
    if (path === undefined) return
    const sha = shaOf(ref)
    try {
      await this.upload(settings, `${settings.prefix}file-objects/${sha.slice(0, 2)}/${sha}`, await readFile(path), 'application/octet-stream')
    } catch (cause) {
      throw new AttachmentError(
        `COS 闄勪欢鍐欏叆澶辫触锛?{cause instanceof Error ? cause.message : String(cause)}`,
        'ATTACHMENT_WRITE_FAILED',
        { cause },
      )
    }
  }

  private async ensureLocal(settings: Settings, key: string, path: string): Promise<void> {
    if (existsSync(path)) return
    const bytes = await this.download(settings, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  override async saveImage(input: Parameters<LocalAttachmentStore['saveImage']>[0]): Promise<ImageAttachmentRef> {
    const ref = await super.saveImage(input)
    await this.pushImage(ref)
    return ref
  }

  override async saveImages(inputs: Parameters<LocalAttachmentStore['saveImages']>[0]): Promise<readonly ImageAttachmentRef[]> {
    const refs = await super.saveImages(inputs)
    for (const ref of refs) await this.pushImage(ref)
    return refs
  }

  override async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<Awaited<ReturnType<LocalAttachmentStore['readImage']>>> {
    const settings = await this.settings()
    const path = this.imageHostPath(ref)
    if (settings !== undefined && path !== undefined && !existsSync(path)) {
      const sha = shaOf(ref)
      await this.ensureLocal(settings, `${settings.prefix}objects/${sha.slice(0, 2)}/${sha}`, path)
    }
    return super.readImage(ref, signal)
  }

  override async saveFile(input: Parameters<LocalAttachmentStore['saveFile']>[0]): Promise<FileAttachmentRef> {
    const ref = await super.saveFile(input)
    await this.pushFile(ref)
    return ref
  }

  override async saveFileStream(input: Parameters<LocalAttachmentStore['saveFileStream']>[0]): Promise<FileAttachmentRef> {
    const ref = await super.saveFileStream(input)
    await this.pushFile(ref)
    return ref
  }

  override readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    const self = this
    const base = super.readFileStream(ref, signal)
    return (async function* () {
      const settings = await self.settings()
      const path = self.fileHostPath(ref)
      if (settings !== undefined && path !== undefined && !existsSync(path)) {
        const sha = shaOf(ref)
        await self.ensureLocal(settings, `${settings.prefix}file-objects/${sha.slice(0, 2)}/${sha}`, path)
      }
      yield* base
    })()
  }
}
