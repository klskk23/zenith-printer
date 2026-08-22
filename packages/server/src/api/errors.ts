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
import { DEFAULT_LOCALE, type Locale } from '../i18n/types.ts'
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
  /** Upstream turned us away for volume — ours to retry, not to report as a bug. */
  TooManyRequests: 429,
  ServiceUnavailable: 503,
  /** An upstream service did not answer in time. */
  GatewayTimeout: 504,
  InternalServerError: 500,
} as const

export type HttpStatusValue = (typeof HttpStatus)[keyof typeof HttpStatus]

/** Every failure surfaced to a client goes through this. */
export class ApiError extends Error {
  readonly status: HttpStatusValue
  /**
   * The stable, machine-readable identifier. This — not the prose — is what
   * the error *is*; the wording is resolved per request from the caller's
   * language.
   */
  readonly code: string
  /** Copy in the default language, for logs and for callers inside the process. */
  readonly body: UserFacingError
  readonly details: Record<string, unknown> | undefined
  /** Set when the failure came from the device, so the right table is used. */
  readonly deviceReasonId: number | undefined

  constructor(
    status: HttpStatusValue,
    body: UserFacingError,
    details?: Record<string, unknown>,
    deviceReasonId?: number,
  ) {
    super(`${body.code}: ${body.what}`)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.body = body
    this.details = details
    this.deviceReasonId = deviceReasonId
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

  /**
   * The request is missing something it must state explicitly.
   *
   * Distinct from `unprocessable`: the request is not wrong about the world,
   * it simply has not said yes to something irreversible yet.
   */
  static badRequest(code: string, details?: Record<string, unknown>): ApiError {
    return ApiError.fromCode(HttpStatus.BadRequest, code, details)
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

/**
 * Turn a failure into its wire form, in the caller's language.
 *
 * The prose is resolved here rather than where the error was thrown, because
 * this is the first point that knows who is asking. Threading a locale through
 * every throw site would put a presentation concern into the middle of the
 * business logic, and every new throw would be a chance to forget it.
 */
export function toErrorResponse(
  error: unknown,
  locale: Locale = DEFAULT_LOCALE,
): {
  status: HttpStatusValue
  body: ErrorResponseBody
} {
  if (error instanceof ApiError) {
    // Re-resolved from the stable code, so the same failure reads in whichever
    // language was asked for.
    const body = error.deviceReasonId === undefined
      ? describeAppError(error.code, locale)
      : describeDeviceError(error.deviceReasonId, locale)
    return {
      status: error.status,
      body: error.details ? { ...body, details: error.details } : body,
    }
  }

  // An unreachable device is the only failure class that needs a person to walk
  // over to the machine, so it gets its own status (FR-036, FR-047).
  if (error instanceof PrinterUnreachableError) {
    return {
      status: HttpStatus.ServiceUnavailable,
      body: { ...describeAppError('PRINTER_UNREACHABLE', locale), details: { address: error.address } },
    }
  }

  if (error instanceof PrinterDeviceError) {
    // A device that answered and refused is not an internal error: saying so
    // sends the operator to the logs when the fix is at the machine.
    const body =
      error.reasonId === undefined
        ? describeAppError('DEVICE_ERROR', locale)
        : describeDeviceError(error.reasonId, locale)
    return { status: HttpStatus.UnprocessableEntity, body }
  }

  return { status: HttpStatus.InternalServerError, body: describeAppError('INTERNAL_ERROR', locale) }
}
