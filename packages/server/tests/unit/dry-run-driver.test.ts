import { describe, expect, it } from 'vitest'
import { DryRunDriver } from '../../src/drivers/dry-run/dry-run-driver.ts'
import { silentLogger } from '../support/queue-harness.ts'
import type { BinaryBitmap } from '../../src/drivers/port.ts'

const page: BinaryBitmap = { widthDots: 400, heightDots: 240, data: new Uint8Array(50 * 240) }
const OPTIONS = { density: 3, labelType: 1, printDirection: 'top' as const }

function makeDriver(kind: 'niimbot' | 'zpl' = 'niimbot'): DryRunDriver {
  return new DryRunDriver({ kind, printerId: 'p1', logger: silentLogger })
}

describe('kind-specific capabilities', () => {
  it('reports the narrow head for niimbot', async () => {
    expect((await makeDriver('niimbot').probe()).printheadPixels).toBe(576)
  })

  it('reports the wide head for zpl', async () => {
    // Flattening the two would let UI work proceed against a canvas limit no
    // real printer has.
    expect((await makeDriver('zpl').probe()).printheadPixels).toBe(832)
  })

  it(`mirrors each kind's consumable reporting`, async () => {
    expect((await makeDriver('niimbot').probe()).supportsConsumableLevel).toBe(true)
    // FR-016 has a visible consequence, so a dry run must not hide it.
    expect((await makeDriver('zpl').probe()).supportsConsumableLevel).toBe(false)
  })

  it('lets a caller override the stand-in values', async () => {
    const driver = new DryRunDriver({
      kind: 'niimbot',
      printerId: 'p1',
      logger: silentLogger,
      capabilities: { model: 'custom', dpi: 300 },
    })
    const probed = await driver.probe()
    expect(probed.model).toBe('custom')
    expect(probed.dpi).toBe(300)
  })
})

describe('going through the motions', () => {
  it('reports progress for every page', async () => {
    const seen: number[] = []
    await makeDriver().printPages([page, page, page], OPTIONS, (n) => seen.push(n))
    expect(seen).toEqual([1, 2, 3])
  })

  it('handles a full hundred-copy batch', async () => {
    const seen: number[] = []
    await makeDriver().printPages(Array.from({ length: 100 }, () => page), OPTIONS, (n) => seen.push(n))
    expect(seen).toHaveLength(100)
    expect(seen.at(-1)).toBe(100)
  })

  it('never reports remaining stock it cannot know', async () => {
    expect((await makeDriver().preflight(80)).remainingLabels).toBeNull()
  })

  it('always passes pre-flight', async () => {
    const result = await makeDriver().preflight(80)
    expect(result.ok).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('connects and disconnects without touching anything', async () => {
    const driver = makeDriver()
    await expect(driver.connect()).resolves.toBeUndefined()
    await expect(driver.disconnect()).resolves.toBeUndefined()
  })

  it('honours a per-page delay', async () => {
    const driver = new DryRunDriver({ kind: 'niimbot', printerId: 'p1', logger: silentLogger, pageDelayMs: 5 })
    const started = Date.now()
    await driver.printPages([page, page], OPTIONS, () => {})
    expect(Date.now() - started).toBeGreaterThanOrEqual(8)
  })

  it('accepts an empty batch', async () => {
    const seen: number[] = []
    await makeDriver().printPages([], OPTIONS, (n) => seen.push(n))
    expect(seen).toEqual([])
  })
})
