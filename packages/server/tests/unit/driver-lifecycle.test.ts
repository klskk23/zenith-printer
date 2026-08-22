import { describe, expect, it } from 'vitest'
import type { NiimbotAbstractClient } from '@mmote/niimbluelib'
import { NiimbotDriver } from '../../src/drivers/niimbot/niimbot-driver.ts'
import {
  PrinterDeviceError,
  PrinterUnreachableError,
  type BinaryBitmap,
  type PageSource,
} from '../../src/drivers/port.ts'
import { B3SP_METADATA, FakeNiimbotClient, type FakeClientOptions } from '../support/fake-niimbot-client.ts'

/**
 * The port's page source, from a plain array.
 *
 * Drivers pull pages one at a time now; these tests care about what is sent,
 * not about how the pages arrive, so they wrap a list.
 */
function source(pages: BinaryBitmap[]): PageSource {
  return { total: pages.length, at: (index: number) => pages[index]! }
}

function makeDriver(options: FakeClientOptions = {}): { driver: NiimbotDriver; client: FakeNiimbotClient } {
  const client = new FakeNiimbotClient({ metadata: B3SP_METADATA, ...options })
  const driver = new NiimbotDriver({
    createClient: () => client as unknown as NiimbotAbstractClient,
    printTaskName: 'B1',
    address: '/dev/ttyACM0',
  })
  return { driver, client }
}

function page(widthDots = 8, heightDots = 2): BinaryBitmap {
  return { widthDots, heightDots, data: new Uint8Array(Math.ceil(widthDots / 8) * heightDots).fill(0xff) }
}

const PRINT_OPTIONS = { density: 3, labelType: 1, printDirection: 'top' as const }

describe('connect', () => {
  it('reports an unreachable device rather than leaking the driver error', async () => {
    const { driver } = makeDriver({ connectError: new Error('ENOENT') })
    await expect(driver.connect()).rejects.toThrow(PrinterUnreachableError)
  })

  it('does not retry internally', async () => {
    // FR-047: retry policy belongs to the queue, not the driver.
    const { driver, client } = makeDriver({ connectError: new Error('ENOENT') })
    await driver.connect().catch(() => undefined)
    expect(client.connectCount).toBe(1)
  })

  it('rejects a connection that resolved but never handshook', async () => {
    // niimbluelib's serial client resolves connect() even with nothing on the
    // other end; its protocol timeouts arrive later and outside the promise.
    // A resolved connect() therefore proves nothing, and trusting it turns the
    // most common real failure — an idle printer that powered itself off —
    // into an opaque internal error.
    const { driver } = makeDriver({ metadata: undefined, printerInfo: undefined })
    await expect(driver.connect()).rejects.toThrow(PrinterUnreachableError)
  })

  it('accepts a connection that produced real handshake fields', async () => {
    const { driver } = makeDriver({ metadata: undefined, printerInfo: { serial: 'H508010165' } })
    await expect(driver.connect()).resolves.toBeUndefined()
  })

  it('rejects a connection whose printer info came back empty', async () => {
    // Measured against a missing /dev/ttyACM0: getPrinterInfo() returns {},
    // not undefined, and isConnected() returns true. Emptiness has to be
    // judged by contents, not by the object existing.
    const { driver } = makeDriver({ metadata: undefined, printerInfo: {} })
    await expect(driver.connect()).rejects.toThrow(PrinterUnreachableError)
  })

  it.each(['connectResult', 'modelId', 'serial'])(
    'treats %s as proof the handshake completed',
    async (field) => {
      const { driver } = makeDriver({ metadata: undefined, printerInfo: { [field]: 1 } })
      await expect(driver.connect()).resolves.toBeUndefined()
    },
  )

  it('releases the half-open connection when the handshake never completed', async () => {
    const { driver, client } = makeDriver({ metadata: undefined, printerInfo: undefined })
    await driver.connect().catch(() => undefined)
    expect(client.disconnectCount).toBe(1)
  })

  it('names the address so the operator knows which machine to check', async () => {
    const { driver } = makeDriver({ connectError: new Error('ENOENT') })
    try {
      await driver.connect()
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as PrinterUnreachableError).address).toBe('/dev/ttyACM0')
    }
  })
})

describe('resource release', () => {
  it('is safe to disconnect when connect failed', async () => {
    // Constitution ("Resource safety"): release on every path, including the
    // one where there is nothing to release.
    const { driver } = makeDriver({ connectError: new Error('ENOENT') })
    await driver.connect().catch(() => undefined)
    await expect(driver.disconnect()).resolves.toBeUndefined()
  })

  it('releases the print task when a page fails midway', async () => {
    const { driver, client } = makeDriver({ failOnPage: { index: 1, error: new Error('jam') } })
    await driver.connect()
    await expect(driver.printPages(source([page(), page(), page()]), PRINT_OPTIONS, () => {})).rejects.toThrow()
    // printEnd must still have run, or the printer stays in a print state.
    expect(client.printEndCount).toBe(1)
  })

  it('releases the print task on success too', async () => {
    const { driver, client } = makeDriver()
    await driver.connect()
    await driver.printPages(source([page()]), PRINT_OPTIONS, () => {})
    expect(client.printEndCount).toBe(1)
  })

  it('tolerates a second disconnect', async () => {
    const { driver } = makeDriver()
    await driver.connect()
    await driver.disconnect()
    await expect(driver.disconnect()).resolves.toBeUndefined()
  })

  it('refuses to print when not connected', async () => {
    const { driver } = makeDriver()
    await expect(driver.printPages(source([page()]), PRINT_OPTIONS, () => {})).rejects.toThrow(
      PrinterUnreachableError,
    )
  })
})

describe('probe', () => {
  it('reports the capabilities the device advertised', async () => {
    const { driver } = makeDriver({ printerInfo: { serial: 'H508010165', softwareVersion: '0x030f' } })
    await driver.connect()
    const capabilities = await driver.probe()

    expect(capabilities.dpi).toBe(203)
    expect(capabilities.printheadPixels).toBe(576)
    expect(capabilities.densityMax).toBe(5)
    expect(capabilities.printDirection).toBe('top')
    expect(capabilities.serial).toBe('H508010165')
  })

  it('advertises consumable reporting, which gates the pre-flight check', async () => {
    const { driver } = makeDriver()
    await driver.connect()
    expect((await driver.probe()).supportsConsumableLevel).toBe(true)
  })

  it('fails clearly when the device answered but reports no model metadata', async () => {
    // The handshake produced printer info, so the link is live — the device
    // simply did not identify its model. That is a device fault, not an
    // unreachable printer, and the two must not be conflated.
    const { driver } = makeDriver({ metadata: undefined, printerInfo: { serial: 'H508010165' } })
    await driver.connect()
    await expect(driver.probe()).rejects.toThrow(PrinterDeviceError)
  })
})

describe('preflight', () => {
  it('reports remaining stock from the RFID tag', async () => {
    const { driver } = makeDriver({ rfid: { tagPresent: true, allPaper: 100, usedPaper: 58 } })
    await driver.connect()
    expect((await driver.preflight(10)).remainingLabels).toBe(42)
  })

  it('refuses a job larger than the remaining stock', async () => {
    // FR-015: caught before a single label is burned.
    const { driver } = makeDriver({ rfid: { tagPresent: true, allPaper: 100, usedPaper: 58 } })
    await driver.connect()
    const result = await driver.preflight(80)
    expect(result.ok).toBe(false)
    expect(result.remainingLabels).toBe(42)
  })

  it('prints anyway on third-party stock, which answers rather than failing', async () => {
    // Measured on B3S_P with non-original media: rfidInfo() does NOT throw.
    // It returns tagPresent false and allPaper -1. Treating -1 as a count
    // would report "no stock" and refuse every job on third-party paper.
    const { driver } = makeDriver({ rfid: { tagPresent: false, allPaper: -1, usedPaper: -1 } })
    await driver.connect()
    const result = await driver.preflight(80)
    expect(result.ok).toBe(true)
    expect(result.remainingLabels).toBeNull()
  })

  it('prints anyway when the RFID read genuinely fails', async () => {
    const { driver } = makeDriver({ rfidError: new Error('comm error') })
    await driver.connect()
    expect((await driver.preflight(80)).remainingLabels).toBeNull()
  })

  it('reads remaining stock from original media', async () => {
    // Measured: allPaper 216, usedPaper 6 -> 210 remaining.
    const { driver } = makeDriver({ rfid: { tagPresent: true, allPaper: 216, usedPaper: 6 } })
    await driver.connect()
    expect((await driver.preflight(80)).remainingLabels).toBe(210)
  })

  it('blocks when paper is missing', async () => {
    const { driver } = makeDriver({ heartbeat: { paperInserted: false, lidClosed: true } })
    await driver.connect()
    const result = await driver.preflight(1)
    expect(result.ok).toBe(false)
    expect(result.blockers).toContain(2)
  })

  it('blocks when the lid is open', async () => {
    const { driver } = makeDriver({ heartbeat: { paperInserted: true, lidClosed: false } })
    await driver.connect()
    expect((await driver.preflight(1)).blockers).toContain(1)
  })
})

describe('printing', () => {
  it('follows the init / page / wait / finish sequence', async () => {
    const { driver, client } = makeDriver()
    await driver.connect()
    await driver.printPages(source([page(), page()]), PRINT_OPTIONS, () => {})

    const sequence = client.callNames().filter((name) => name !== 'connect')
    expect(sequence).toEqual([
      'newPrintTask',
      'printInit',
      'printPage',
      'waitForPageFinished',
      'printPage',
      'waitForPageFinished',
      'waitForFinished',
      'printEnd',
    ])
  })

  it('passes the requested density and label type through', async () => {
    const { driver, client } = makeDriver()
    await driver.connect()
    await driver.printPages(source([page()]), { density: 4, labelType: 2, printDirection: 'top' }, () => {})

    const task = client.calls.find((call) => call.name === 'newPrintTask')
    expect(task?.args[0]).toBe('B1')
    expect(task?.args[1]).toMatchObject({ density: 4, labelType: 2, totalPages: 1 })
  })

  it('encodes one image per requested copy', async () => {
    const { driver, client } = makeDriver()
    await driver.connect()
    await driver.printPages(source([page(), page(), page()]), PRINT_OPTIONS, () => {})
    expect(client.printedPages).toHaveLength(3)
  })

  it('reports progress as each page completes', async () => {
    // The only progress signal a hundred-copy job has (FR-020, FR-035).
    const seen: number[] = []
    const { driver, client } = makeDriver()
    await driver.connect()

    const printing = driver.printPages(source([page(), page()]), PRINT_OPTIONS, (n) => seen.push(n))
    client.emit('printprogress', { page: 1, pagesTotal: 2, pagePrintProgress: 100, pageFeedProgress: 100 })
    client.emit('printprogress', { page: 2, pagesTotal: 2, pagePrintProgress: 100, pageFeedProgress: 100 })
    await printing

    expect(seen).toEqual([1, 2])
  })

  it('ignores partial page progress', async () => {
    const seen: number[] = []
    const { driver, client } = makeDriver()
    await driver.connect()
    const printing = driver.printPages(source([page()]), PRINT_OPTIONS, (n) => seen.push(n))
    client.emit('printprogress', { page: 1, pagesTotal: 1, pagePrintProgress: 40, pageFeedProgress: 0 })
    await printing
    expect(seen).toEqual([])
  })

  it('stops listening for progress once the job ends', async () => {
    const seen: number[] = []
    const { driver, client } = makeDriver()
    await driver.connect()
    await driver.printPages(source([page()]), PRINT_OPTIONS, (n) => seen.push(n))
    client.emit('printprogress', { page: 9, pagesTotal: 9, pagePrintProgress: 100, pageFeedProgress: 100 })
    expect(seen).toEqual([])
  })
})
