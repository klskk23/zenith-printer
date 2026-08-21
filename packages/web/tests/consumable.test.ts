import { describe, expect, it } from 'vitest'
import { consumableDisplay } from '../src/pages/consumable.ts'
import type { Capabilities, Printer } from '../src/api/types.ts'

const CAPS: Capabilities = {
  dpi: 203,
  printheadPixels: 384,
  densityMin: 1,
  densityMax: 5,
  densityDefault: 3,
  paperTypes: [1],
  printDirection: 'top',
  supportsConsumableLevel: true,
  model: 'B3S_P',
  serial: null,
  firmwareVersion: null,
}

function printer(capabilities: Capabilities | null): Printer {
  return {
    id: 'p1',
    name: 'printer',
    kind: 'niimbot',
    transport: 'serial',
    address: '/dev/ttyACM0',
    capabilities,
    queueState: 'running',
    queuePausedReason: null,
    lastProbedAt: null,
    offsetXDots: 0,
    offsetYDots: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
  }
}

describe('consumableDisplay', () => {
  it('says so when the printer has never been probed', () => {
    expect(consumableDisplay(printer(null))).toEqual({ kind: 'not-probed' })
  })

  it('reports support when the model can count its stock', () => {
    expect(consumableDisplay(printer(CAPS))).toEqual({ kind: 'supported' })
  })

  /**
   * The case FR-026 exists for. A blank line here reads as "not loaded yet";
   * the truth is that this model never reports, so it will run out mid-batch
   * with no warning at all.
   */
  it('distinguishes "cannot report" from "not probed yet"', () => {
    const zpl = consumableDisplay(printer({ ...CAPS, supportsConsumableLevel: false }))
    expect(zpl).toEqual({ kind: 'unsupported' })
    expect(zpl).not.toEqual({ kind: 'not-probed' })
  })

  it('never returns an empty or absent state', () => {
    for (const caps of [null, CAPS, { ...CAPS, supportsConsumableLevel: false }]) {
      expect(consumableDisplay(printer(caps)).kind).toBeTruthy()
    }
  })
})
