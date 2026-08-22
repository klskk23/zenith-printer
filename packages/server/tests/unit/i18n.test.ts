/**
 * Localised error copy.
 *
 * The server words its own errors — the frontend shows them verbatim, so one
 * fault never gets two descriptions, and the CLI shares the same table. The
 * cost of that choice is that switching the interface language has to switch
 * these too, or the UI ends up half translated with the errors left behind.
 */
import { describe, expect, it } from 'vitest'
import { negotiateLocale } from '../../src/i18n/negotiate.ts'
import {
  allDeviceErrorCodes,
  bundleFor,
  describeAppError,
  describeDeviceError,
  unmappedDeviceErrorCodes,
} from '../../src/i18n/error-map.ts'
import { APP_ERROR_CODES, LOCALES } from '../../src/i18n/types.ts'

const hasHan = (text: string): boolean => /[一-鿿]/.test(text)

describe('negotiateLocale', () => {
  it.each([
    ['en-US', 'en-US'],
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['zh-CN', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
  ])('reads %s as %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected)
  })

  it('honours quality values', () => {
    expect(negotiateLocale('en;q=0.2,zh-CN;q=0.9')).toBe('zh-CN')
    expect(negotiateLocale('zh-CN;q=0.2,en-US;q=0.9')).toBe('en-US')
  })

  it('skips a locale it does not have', () => {
    expect(negotiateLocale('fr-FR,en-US;q=0.8')).toBe('en-US')
  })

  /** Chinese is the project default, and a missing header is the common case. */
  it.each([undefined, '', '   ', '*', 'fr-FR', 'nonsense'])('falls back to Chinese for %s', (header) => {
    expect(negotiateLocale(header)).toBe('zh-CN')
  })

  it('ignores a candidate with zero quality', () => {
    expect(negotiateLocale('en-US;q=0')).toBe('zh-CN')
  })
})

describe('application errors', () => {
  it('words them in Chinese by default', () => {
    expect(hasHan(describeAppError('PRINTER_UNREACHABLE').what)).toBe(true)
  })

  it('words them in English when asked', () => {
    const english = describeAppError('PRINTER_UNREACHABLE', 'en-US')
    expect(hasHan(english.what)).toBe(false)
    expect(english.what.length).toBeGreaterThan(0)
  })

  /**
   * The code is what the frontend branches on. If it moved with the language,
   * every consumer would need to know the language to understand the response.
   */
  it('keeps the code identical across languages', () => {
    for (const code of APP_ERROR_CODES) {
      expect(describeAppError(code, 'en-US').code).toBe(describeAppError(code, 'zh-CN').code)
    }
  })

  it('covers the codes this feature added', () => {
    // The loop below already checks every registered code. This names the new
    // ones so that removing one from the registry — which would make the loop
    // pass by having less to check — fails here instead.
    for (const code of [
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
      'ROW_SELECTION_STALE',
      'BARCODE_EMPTY_VALUE',
      'SEQUENCE_RESET_NOT_CONFIRMED',
      'DATA_SOURCE_DELETE_NOT_CONFIRMED',
    ] as const) {
      expect(APP_ERROR_CODES, code).toContain(code)
    }
  })

  it('answers all three parts in both languages', () => {
    for (const locale of LOCALES) {
      for (const code of APP_ERROR_CODES) {
        const copy = describeAppError(code, locale)
        expect(copy.what.length).toBeGreaterThan(0)
        expect(copy.why.length).toBeGreaterThan(0)
        expect(copy.next.length).toBeGreaterThan(0)
      }
    }
  })

  it('turns an unknown code into an internal error rather than leaking it', () => {
    expect(describeAppError('NOT_A_REAL_CODE', 'en-US').code).toBe('INTERNAL_ERROR')
  })
})

describe('device errors', () => {
  it('words them in the requested language', () => {
    expect(hasHan(describeDeviceError(2, 'en-US').what)).toBe(false)
    expect(hasHan(describeDeviceError(2, 'zh-CN').what)).toBe(true)
  })

  it('keeps the code stable across languages', () => {
    expect(describeDeviceError(2, 'en-US').code).toBe(describeDeviceError(2, 'zh-CN').code)
  })

  it('never emits a bare number, in any language', () => {
    for (const locale of LOCALES) {
      for (const id of allDeviceErrorCodes()) {
        expect(describeDeviceError(id, locale).what).not.toMatch(/^\d+$/)
      }
    }
  })
})

/**
 * Completeness cannot be checked by the type system: the device table is keyed
 * by numbers from a third-party enum. So it is checked here.
 */
describe('bundle completeness', () => {
  it.each(LOCALES)('%s covers every device error code', (locale) => {
    expect(unmappedDeviceErrorCodes(locale)).toEqual([])
  })

  it('has identical device keys in every locale', () => {
    const keys = LOCALES.map((locale) => Object.keys(bundleFor(locale).device).sort().join(','))
    expect(new Set(keys).size).toBe(1)
  })

  it('has identical application keys in every locale', () => {
    const keys = LOCALES.map((locale) => Object.keys(bundleFor(locale).app).sort().join(','))
    expect(new Set(keys).size).toBe(1)
  })

  it('leaves no Chinese text in the English bundle', () => {
    const bundle = bundleFor('en-US')
    for (const copy of [...Object.values(bundle.device), ...Object.values(bundle.app)]) {
      expect(hasHan(`${copy.what}${copy.why}${copy.next}`)).toBe(false)
    }
  })
})
