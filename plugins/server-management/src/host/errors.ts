import { ServerError, type ErrorCode, type MessageParams } from '../shared/errors.ts'

export class HttpError extends ServerError {
  readonly status: number
  constructor(status: number, code: ErrorCode, params: MessageParams = {}, options?: ErrorOptions) {
    super(code, params, options)
    this.name = 'HttpError'
    this.status = status
  }
}
