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
import { ZH_CN } from './zh-CN.ts'
import { EN_US } from './en-US.ts'
import {
  APP_ERROR_CODES,
  DEFAULT_LOCALE,
  type AppErrorCode,
  type ErrorCopy,
  type Locale,
  type LocaleBundle,
} from './types.ts'

const BUNDLES: Record<Locale, LocaleBundle> = { 'zh-CN': ZH_CN, 'en-US': EN_US }

export function bundleFor(locale: Locale = DEFAULT_LOCALE): LocaleBundle {
  return BUNDLES[locale] ?? BUNDLES[DEFAULT_LOCALE]
}

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
export function describeDeviceError(reasonId: number, locale: Locale = DEFAULT_LOCALE): UserFacingError {
  const bundle = bundleFor(locale)
  const copy = bundle.device[reasonId]
  if (copy !== undefined) {
    return { code: deviceErrorCode(reasonId), ...copy }
  }
  // Still no bare number: an unmapped code gets a usable message.
  return { code: deviceErrorCode(reasonId), ...bundle.app.INTERNAL_ERROR }
}

/** Whether a string is one of the known application error codes. */
export function isAppErrorCode(code: string): code is AppErrorCode {
  return (APP_ERROR_CODES as readonly string[]).includes(code)
}

/**
 * Map an application-level code to readable copy.
 *
 * The `code` is the stable part and never varies with locale — the frontend
 * branches on it. Only the prose changes.
 */
export function describeAppError(code: string, locale: Locale = DEFAULT_LOCALE): UserFacingError {
  const bundle = bundleFor(locale)
  // An unknown code becomes INTERNAL_ERROR rather than leaking the raw string:
  // a code with no copy would reach the user as a blank message.
  if (!isAppErrorCode(code)) {
    return { code: 'INTERNAL_ERROR', ...bundle.app.INTERNAL_ERROR }
  }
  return { code, ...bundle.app[code] }
}

/** Codes with no translation in a given locale. Always empty; asserted in tests. */
export function unmappedDeviceErrorCodes(locale: Locale = DEFAULT_LOCALE): number[] {
  const bundle = bundleFor(locale)
  return allDeviceErrorCodes().filter((id) => bundle.device[id] === undefined)
}
