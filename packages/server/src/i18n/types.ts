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
  'TEMPLATE_PRINTER_MISMATCH',
  'TEMPLATE_VERSION_CONFLICT',
  'QUEUE_PAUSED',
  'DEVICE_ERROR',
  'RENDER_FAILED',
  'JOB_INTERRUPTED_BY_RESTART',
  'CONFIRMATION_REQUIRED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
] as const

export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

export interface LocaleBundle {
  /** Device faults, keyed by niimbluelib's `PrinterErrorCode`. */
  device: Readonly<Record<number, ErrorCopy>>
  /** Application-level failures. Every code MUST be present. */
  app: Readonly<Record<AppErrorCode, ErrorCopy>>
}
