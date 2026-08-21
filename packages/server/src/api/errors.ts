/**
 * HTTP error contract.
 *
 * Constitution Principle III.A: status codes are stable and the same class of
 * failure always uses the same one. The dividing line between 409 and 422 is
 * worth stating plainly, because getting it wrong makes the frontend guess:
 *
 *   409 — a question of TIMING. Try later and it might succeed.
 *         (cancelling a job already printing; deleting a printer with a queue)
 *   422 — a question of CONTENT. It will never succeed unchanged.
 *         (not enough stock; sequence overflow; template/printer mismatch)
 */
import { describeAppError, describeDeviceError, type UserFacingError } from '../i18n/error-map.ts'
import { PrinterDeviceError, PrinterUnreachableError } from '../drivers/port.ts'

export const HttpStatus = {
  Ok: 200,
  Created: 201,
  Accepted: 202,
  NoContent: 204,
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
  UnprocessableEntity: 422,
  ServiceUnavailable: 503,
  InternalServerError: 500,
} as const

export type HttpStatusValue = (typeof HttpStatus)[keyof typeof HttpStatus]

/** Every failure surfaced to a client goes through this. */
export class ApiError extends Error {
  readonly status: HttpStatusValue
  readonly body: UserFacingError
  readonly details: Record<string, unknown> | undefined

  constructor(status: HttpStatusValue, body: UserFacingError, details?: Record<string, unknown>) {
    super(`${body.code}: ${body.what}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.details = details
  }

  static fromCode(
    status: HttpStatusValue,
    code: string,
    details?: Record<string, unknown>,
  ): ApiError {
    return new ApiError(status, describeAppError(code), details)
  }

  /** Timing problem — retrying later may work. */
  static conflict(code: string, details?: Record<string, unknown>): ApiError {
    return ApiError.fromCode(HttpStatus.Conflict, code, details)
  }

  /** Content problem — the same request will never succeed. */
  static unprocessable(code: string, details?: Record<string, unknown>): ApiError {
    return ApiError.fromCode(HttpStatus.UnprocessableEntity, code, details)
  }

  static notFound(details?: Record<string, unknown>): ApiError {
    return ApiError.fromCode(HttpStatus.NotFound, 'NOT_FOUND', details)
  }

  static unreachable(details?: Record<string, unknown>): ApiError {
    return ApiError.fromCode(HttpStatus.ServiceUnavailable, 'PRINTER_UNREACHABLE', details)
  }
}

/** Response body shape. Machine-readable code plus the three-part prose. */
export interface ErrorResponseBody extends UserFacingError {
  details?: Record<string, unknown>
}

export function toErrorResponse(error: unknown): {
  status: HttpStatusValue
  body: ErrorResponseBody
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: error.details ? { ...error.body, details: error.details } : error.body,
    }
  }

  // An unreachable device is the only failure class that needs a person to walk
  // over to the machine, so it gets its own status (FR-036, FR-047).
  if (error instanceof PrinterUnreachableError) {
    return {
      status: HttpStatus.ServiceUnavailable,
      body: { ...describeAppError('PRINTER_UNREACHABLE'), details: { address: error.address } },
    }
  }

  if (error instanceof PrinterDeviceError) {
    // A device that answered and refused is not an internal error: saying so
    // sends the operator to the logs when the fix is at the machine.
    const body =
      error.reasonId === undefined
        ? describeAppError('DEVICE_ERROR')
        : describeDeviceError(error.reasonId)
    return { status: HttpStatus.UnprocessableEntity, body }
  }

  return { status: HttpStatus.InternalServerError, body: describeAppError('INTERNAL_ERROR') }
}
