/**
 * Shared shape for every locale bundle.
 *
 * Both locales are typed against `LocaleBundle`, so a key present in one and
 * missing from the other is a compile error rather than a runtime blank. The
 * completeness of the device-error table cannot be expressed in the type system
 * (its keys are numbers from a third-party enum), so a test asserts that
 * separately.
 */

export interface ErrorCopy {
  what: string
  why: string
  next: string
}

/** Locales this service can answer in. Chinese is the fallback (Principle IV). */
export const LOCALES = ['zh-CN', 'en-US'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'zh-CN'

/** Application-level error codes. Adding one here forces both locales to fill it in. */
export const APP_ERROR_CODES = [
  'PRINTER_UNREACHABLE',
  'PRINTER_HAS_QUEUED_JOBS',
  'JOB_ALREADY_PRINTING',
  'INSUFFICIENT_CONSUMABLE',
  'SEQUENCE_OVERFLOW',
  'FIELD_VALIDATION_FAILED',
  'TEMPLATE_VERSION_CONFLICT',
  'QUEUE_PAUSED',
  'DEVICE_ERROR',
  'RENDER_FAILED',
  'JOB_INTERRUPTED_BY_RESTART',
  'CONFIRMATION_REQUIRED',
  'CALIBRATION_STOCK_UNKNOWN',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  // 003 — variables and table data sources.
  'CSV_NO_HEADER',
  'CSV_DUPLICATE_COLUMN',
  'CSV_TOO_MANY_ROWS',
  'CSV_DECODE_FAILED',
  'DATA_SOURCE_NAME_TAKEN',
  'DATA_SOURCE_COLUMNS_REMOVED',
  'DATA_SOURCE_UNKNOWN_COLUMN',
  'NO_ROWS_SELECTED',
  'BATCH_TOO_LARGE',
  'VARIABLE_NOT_DEFINED',
  'VARIABLE_NAME_COLLIDES',
  'SEQUENCE_POOL_IN_USE',
  'DATA_SOURCE_NOT_LINKED',
  'DATA_SOURCE_REFRESH_IN_PROGRESS',
  'GOOGLE_URL_INVALID',
  'GOOGLE_NOT_CONFIGURED',
  'GOOGLE_NOT_SHARED',
  'GOOGLE_SPREADSHEET_NOT_FOUND',
  'GOOGLE_CREDENTIALS_INVALID',
  'GOOGLE_RATE_LIMITED',
  'GOOGLE_UNREACHABLE',
  'GOOGLE_WORKSHEET_NOT_FOUND',
  'GOOGLE_WORKSHEET_EMPTY',
  'TEMPLATE_FILE_INVALID',
  'TEMPLATE_FILE_TOO_NEW',
  'TEMPLATE_ALREADY_EXISTS',
  'ROW_SELECTION_STALE',
  'BARCODE_EMPTY_VALUE',
  // Confirmation is per-operation, not one shared code: the three-part message
  // has to say what *this* action does. Reusing the print confirmation told
  // somebody resetting a counter that it would consume paper.
  'SEQUENCE_RESET_NOT_CONFIRMED',
  'DATA_SOURCE_DELETE_NOT_CONFIRMED',
] as const

export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

export interface LocaleBundle {
  /** Device faults, keyed by niimbluelib's `PrinterErrorCode`. */
  device: Readonly<Record<number, ErrorCopy>>
  /** Application-level failures. Every code MUST be present. */
  app: Readonly<Record<AppErrorCode, ErrorCopy>>
}
