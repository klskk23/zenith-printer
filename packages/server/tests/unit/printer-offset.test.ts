/**
 * Position correction on the printer.
 *
 * It belongs to the machine, not to the paper: reloading a roll can shift where
 * the paper sits even when the stock is identical. The consequence that matters
 * for this test file is that switching profiles must not move the print.
 */
import { describe, expect, it } from 'vitest'
import { isOffsetWithinHead, type ProbedCapabilities } from '../../src/domain/printer.ts'
import { openDatabase } from '../../src/db/index.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'
import { ProfileRepo } from '../../src/db/repositories/profile-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

const CAPS: ProbedCapabilities = {
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

function harness() {
  const db = openDatabase({ location: ':memory:' })
  const deps = { db, clock: new FixedClock('2026-08-21T00:00:00.000Z'), ids: new SequentialIdGenerator('id') }
  const printers = new PrinterRepo(deps)
  const profiles = new ProfileRepo(deps)
  const printer = printers.create({ name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0' })
  printers.saveCapabilities(printer.id, CAPS)
  return { printers, profiles, printerId: printer.id }
}

const stock = (name: string) => ({
  name,
  density: 3,
  labelType: 1,
  labelWidthMm: 50,
  labelHeightMm: 30,
  marginTopMm: 0,
  marginRightMm: 0,
  marginBottomMm: 0,
  marginLeftMm: 0,
  isDefault: false,
})

describe('storage', () => {
  it('starts at zero', () => {
    const { printers, printerId } = harness()
    expect(printers.find(printerId)).toMatchObject({ offsetXDots: 0, offsetYDots: 0 })
  })

  it('round-trips a correction', () => {
    const { printers, printerId } = harness()
    printers.setOffset(printerId, 4, -3)
    expect(printers.find(printerId)).toMatchObject({ offsetXDots: 4, offsetYDots: -3 })
  })

  it('keeps whole dots', () => {
    const { printers, printerId } = harness()
    printers.setOffset(printerId, 2.6, -1.4)
    expect(printers.find(printerId)).toMatchObject({ offsetXDots: 3, offsetYDots: -1 })
  })

  it('keeps two printers independent', () => {
    const { printers, printerId } = harness()
    const other = printers.create({ name: 'second', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM1' })
    printers.setOffset(printerId, 5, 0)
    expect(printers.find(other.id)).toMatchObject({ offsetXDots: 0 })
  })
})

/**
 * FR-053, and the whole point of moving the field. Before this change the
 * offset lived on the profile, so choosing a different roll silently moved the
 * print — and it had to be re-entered for every profile of the same machine.
 */
describe('independence from profiles', () => {
  it('survives creating profiles', () => {
    const { printers, profiles, printerId } = harness()
    printers.setOffset(printerId, 6, -2)

    profiles.create(printerId, { ...stock('original'), isDefault: true })
    profiles.create(printerId, stock('third-party'))

    expect(printers.find(printerId)).toMatchObject({ offsetXDots: 6, offsetYDots: -2 })
  })

  it('survives switching which profile is default', () => {
    const { printers, profiles, printerId } = harness()
    const first = profiles.create(printerId, { ...stock('original'), isDefault: true })
    const second = profiles.create(printerId, stock('third-party'))
    printers.setOffset(printerId, 6, -2)

    profiles.update(second.id, { ...stock('third-party'), isDefault: true })
    profiles.update(first.id, stock('original'))

    expect(printers.find(printerId)).toMatchObject({ offsetXDots: 6, offsetYDots: -2 })
  })

  it('survives deleting every profile', () => {
    const { printers, profiles, printerId } = harness()
    const profile = profiles.create(printerId, { ...stock('original'), isDefault: true })
    printers.setOffset(printerId, 6, -2)

    profiles.delete(profile.id)

    expect(printers.find(printerId)).toMatchObject({ offsetXDots: 6, offsetYDots: -2 })
  })
})

describe('isOffsetWithinHead', () => {
  it('accepts a correction smaller than the head', () => {
    expect(isOffsetWithinHead({ offsetXDots: 20, offsetYDots: -20 }, CAPS)).toBe(true)
  })

  it('rejects one that would push everything off the paper', () => {
    // Rejected, not clamped: a clamped offset looks accepted and does nothing.
    expect(isOffsetWithinHead({ offsetXDots: 400, offsetYDots: 0 }, CAPS)).toBe(false)
    expect(isOffsetWithinHead({ offsetXDots: 0, offsetYDots: -400 }, CAPS)).toBe(false)
  })

  it('allows anything on a printer that has not been probed', () => {
    // Without capabilities there is no limit to check against, and refusing
    // every correction until a probe succeeds would be worse.
    expect(isOffsetWithinHead({ offsetXDots: 9999, offsetYDots: 0 }, null)).toBe(true)
  })
})
