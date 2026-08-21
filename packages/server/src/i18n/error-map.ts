/**
 * Translate failures into the user-facing error shape.
 *
 * Constitution Principle III.0: every message carries what happened, why, and
 * what to do next; device error codes are mapped, never passed through as bare
 * numbers (FR-034).
 *
 * `code` stays stable and machine-readable so the frontend can branch on it;
 * the prose comes from the i18n resources.
 */
import { PrinterErrorCode } from '@mmote/niimbluelib'
import { APP_ERROR_COPY, DEVICE_ERROR_COPY, type ErrorCopy } from './zh-CN.ts'

export interface UserFacingError extends ErrorCopy {
  /** Stable machine-readable identifier — the REST contract's `code`. */
  code: string
}

/** Every value of niimbluelib's PrinterErrorCode enum. */
export function allDeviceErrorCodes(): number[] {
  return Object.values(PrinterErrorCode).filter(
    (value): value is number => typeof value === 'number',
  )
}

/** Machine-readable code for a device fault, e.g. `DEVICE_LACK_PAPER`. */
export function deviceErrorCode(reasonId: number): string {
  const name = PrinterErrorCode[reasonId]
  if (name === undefined) {
    return `DEVICE_UNKNOWN_${reasonId}`
  }
  // CoverOpen -> DEVICE_COVER_OPEN
  const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
  return `DEVICE_${snake}`
}

/** Map a device fault to readable copy. */
export function describeDeviceError(reasonId: number): UserFacingError {
  const copy = DEVICE_ERROR_COPY[reasonId]
  if (copy !== undefined) {
    return { code: deviceErrorCode(reasonId), ...copy }
  }
  // Still no bare number: an unmapped code gets a usable message.
  return {
    code: deviceErrorCode(reasonId),
    ...APP_ERROR_COPY.INTERNAL_ERROR!,
    what: APP_ERROR_COPY.INTERNAL_ERROR!.what,
  }
}

/** Map an application-level code to readable copy. */
export function describeAppError(code: string): UserFacingError {
  const copy = APP_ERROR_COPY[code] ?? APP_ERROR_COPY.INTERNAL_ERROR!
  return { code: APP_ERROR_COPY[code] !== undefined ? code : 'INTERNAL_ERROR', ...copy }
}

/** Codes with no translation. Should always be empty; asserted in tests. */
export function unmappedDeviceErrorCodes(): number[] {
  return allDeviceErrorCodes().filter((id) => DEVICE_ERROR_COPY[id] === undefined)
}
