import { describe, expect, it } from 'vitest'
import { PrinterErrorCode } from '@mmote/niimbluelib'
import {
  allDeviceErrorCodes,
  describeAppError,
  describeDeviceError,
  deviceErrorCode,
  unmappedDeviceErrorCodes,
} from '../../src/i18n/error-map.ts'
import { APP_ERROR_COPY, DEVICE_ERROR_COPY } from '../../src/i18n/zh-CN.ts'

describe('device error coverage', () => {
  it('translates every PrinterErrorCode the library defines', () => {
    // A gap here means a user eventually sees a bare number instead of advice.
    expect(unmappedDeviceErrorCodes()).toEqual([])
  })

  it('covers the faults that actually occur in daily use', () => {
    for (const code of [
      PrinterErrorCode.CoverOpen,
      PrinterErrorCode.LackPaper,
      PrinterErrorCode.Overheat,
      PrinterErrorCode.NoRibbon,
      PrinterErrorCode.B3sAbnormalPaperOutput,
      PrinterErrorCode.ReceiveDataTimeout,
    ]) {
      expect(DEVICE_ERROR_COPY[code]).toBeDefined()
    }
  })

  it('has no stray entries beyond the enum', () => {
    const known = new Set(allDeviceErrorCodes())
    for (const key of Object.keys(DEVICE_ERROR_COPY)) {
      expect(known.has(Number(key))).toBe(true)
    }
  })
})

describe('three-part structure', () => {
  it('gives every device message a what, why and next', () => {
    for (const id of allDeviceErrorCodes()) {
      const described = describeDeviceError(id)
      expect(described.what.length).toBeGreaterThan(0)
      expect(described.why.length).toBeGreaterThan(0)
      expect(described.next.length).toBeGreaterThan(0)
    }
  })

  it('gives every application message a what, why and next', () => {
    for (const code of Object.keys(APP_ERROR_COPY)) {
      const described = describeAppError(code)
      expect(described.what.length).toBeGreaterThan(0)
      expect(described.why.length).toBeGreaterThan(0)
      expect(described.next.length).toBeGreaterThan(0)
    }
  })

  it('never exposes a raw numeric code in the prose', () => {
    // FR-034: users get advice, not reason ids.
    for (const id of allDeviceErrorCodes()) {
      const { what, why, next } = describeDeviceError(id)
      expect(`${what}${why}${next}`).not.toMatch(/reasonId|errorCode|\berror \d+/i)
    }
  })
})

describe('machine-readable codes', () => {
  it('derives a stable snake-case code from the enum name', () => {
    expect(deviceErrorCode(PrinterErrorCode.CoverOpen)).toBe('DEVICE_COVER_OPEN')
    expect(deviceErrorCode(PrinterErrorCode.LackPaper)).toBe('DEVICE_LACK_PAPER')
    expect(deviceErrorCode(PrinterErrorCode.ReceiveDataTimeout)).toBe('DEVICE_RECEIVE_DATA_TIMEOUT')
  })

  it('still produces a code for an id the library does not know', () => {
    expect(deviceErrorCode(9999)).toBe('DEVICE_UNKNOWN_9999')
  })

  it('falls back to a usable message for an unknown id', () => {
    const described = describeDeviceError(9999)
    expect(described.what.length).toBeGreaterThan(0)
    expect(described.next.length).toBeGreaterThan(0)
  })
})

describe('application errors', () => {
  it('tells the user that an unreachable printer needs someone on site', () => {
    // The one failure class that software cannot resolve by itself.
    const described = describeAppError('PRINTER_UNREACHABLE')
    expect(described.code).toBe('PRINTER_UNREACHABLE')
    expect(described.next).toContain('设备旁')
  })

  it('explains that an unknown page count needs a manual count', () => {
    expect(describeAppError('JOB_INTERRUPTED_BY_RESTART').next).toContain('清点')
  })

  it('falls back to the internal error for an unrecognised code', () => {
    expect(describeAppError('NO_SUCH_CODE').code).toBe('INTERNAL_ERROR')
  })
})
