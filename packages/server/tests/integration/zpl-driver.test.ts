import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { FakeTransport } from '../../src/drivers/fake/fake-transport.ts'
import { ZplDriver, densityToDarkness, PC310T_CAPABILITIES } from '../../src/drivers/zpl/zpl-driver.ts'
import { buildLabel, crc16, parseHostStatus, toHexData, toZ64Data } from '../../src/drivers/zpl/zpl-builder.ts'
import { PrinterUnreachableError, type BinaryBitmap } from '../../src/drivers/port.ts'

function bitmapFrom(rows: string[]): BinaryBitmap {
  const heightDots = rows.length
  const widthDots = rows[0]?.length ?? 0
  const bytesPerRow = Math.ceil(widthDots / 8)
  const data = new Uint8Array(bytesPerRow * heightDots)
  for (let y = 0; y < heightDots; y += 1) {
    for (let x = 0; x < widthDots; x += 1) {
      if (rows[y]?.[x] === '#') {
        const i = y * bytesPerRow + (x >> 3)
        data[i] = (data[i] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }
  return { widthDots, heightDots, data }
}

const SAMPLE = bitmapFrom(['########', '#......#', '########'])
const PRINT_OPTIONS = { density: 3, labelType: 1, printDirection: 'top' as const }

function makeDriver(options: { encoding?: 'hex' | 'z64' } = {}) {
  const transport = new FakeTransport()
  const driver = new ZplDriver({
    transport,
    address: '192.168.1.50:9100',
    statusTimeoutMs: 10,
    ...(options.encoding === undefined ? {} : { encoding: options.encoding }),
  })
  return { driver, transport }
}

function sentText(transport: FakeTransport): string {
  return new TextDecoder().decode(transport.writtenBytes())
}

describe('graphic encoding', () => {
  it('emits uppercase hex for the plain form', () => {
    const field = toHexData(SAMPLE)
    expect(field.data).toBe('FF81FF')
    expect(field.data).toBe(field.data.toUpperCase())
  })

  it('reports the byte counts ZPL needs', () => {
    const field = toHexData(SAMPLE)
    expect(field.totalBytes).toBe(3)
    expect(field.bytesPerRow).toBe(1)
  })

  it('round-trips through the compressed form', () => {
    // If the payload does not inflate back to the original bytes, the label
    // prints as noise with nothing anywhere reporting a problem.
    const field = toZ64Data(SAMPLE)
    const payload = field.data.slice(':Z64:'.length, field.data.lastIndexOf(':'))
    expect(new Uint8Array(inflateSync(Buffer.from(payload, 'base64')))).toEqual(SAMPLE.data)
  })

  it('appends a CRC over the encoded payload', () => {
    const field = toZ64Data(SAMPLE)
    const payload = field.data.slice(':Z64:'.length, field.data.lastIndexOf(':'))
    const checksum = field.data.slice(field.data.lastIndexOf(':') + 1)
    expect(checksum).toBe(crc16(payload).toString(16).padStart(4, '0'))
    expect(checksum).toHaveLength(4)
  })

  it('compresses a realistic label far below its hex form', () => {
    // 400x240 is the everyday size; hex would be ~24KB per label.
    const rows = Array.from({ length: 240 }, () => '.'.repeat(400))
    const blank = bitmapFrom(rows)
    expect(toZ64Data(blank).data.length).toBeLessThan(toHexData(blank).data.length / 10)
  })
})

describe('label structure', () => {
  it('wraps the graphic in a complete label', () => {
    const zpl = buildLabel(SAMPLE, { encoding: 'hex' })
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.endsWith('^XZ')).toBe(true)
    expect(zpl).toContain('^GFA,3,3,1,FF81FF')
  })

  it('pins label home so only the bitmap positions content', () => {
    // Offsets are applied to the bitmap instead, which keeps both printer
    // types identical and lets the editor preview them (FR-028).
    expect(buildLabel(SAMPLE, { encoding: 'hex' })).toContain('^LH0,0')
  })

  it('emits darkness when asked', () => {
    expect(buildLabel(SAMPLE, { encoding: 'hex', darkness: 18 })).toContain('^MD18')
  })

  it('omits the quantity command for a single copy', () => {
    // Copies are sent as separate labels, so ^PQ would multiply them.
    expect(buildLabel(SAMPLE, { encoding: 'hex', copies: 1 })).not.toContain('^PQ')
  })

  it('is deterministic for identical input', () => {
    expect(buildLabel(SAMPLE, { encoding: 'z64' })).toBe(buildLabel(SAMPLE, { encoding: 'z64' }))
  })
})

describe('density mapping', () => {
  it('spans the ZPL darkness range', () => {
    expect(densityToDarkness(1, 1, 5)).toBe(0)
    expect(densityToDarkness(5, 1, 5)).toBe(30)
  })

  it('places the middle of the shared scale in the middle', () => {
    // One density scale serves both printers, so the same profile means the
    // same thing on either (Principle III.0).
    expect(densityToDarkness(3, 1, 5)).toBe(15)
  })

  it('clamps values outside the range', () => {
    expect(densityToDarkness(0, 1, 5)).toBe(0)
    expect(densityToDarkness(9, 1, 5)).toBe(30)
  })
})

describe('driver', () => {
  it('reports the model capabilities', async () => {
    const { driver } = makeDriver()
    await driver.connect()
    const capabilities = await driver.probe()
    expect(capabilities.printheadPixels).toBe(832)
    expect(capabilities.model).toBe('PC310T')
  })

  it('declares that it cannot report remaining stock', async () => {
    // FR-016: ~HS says whether paper is out, never how much is left.
    expect(PC310T_CAPABILITIES.supportsConsumableLevel).toBe(false)
    const { driver } = makeDriver()
    await driver.connect()
    expect((await driver.preflight(80)).remainingLabels).toBeNull()
  })

  it('sends one label per copy rather than one burst', async () => {
    // A hundred labels at once would overrun the receive buffer and reduce
    // progress to "sent it all, no idea".
    const { driver, transport } = makeDriver({ encoding: 'hex' })
    await driver.connect()
    await driver.printPages([SAMPLE, SAMPLE, SAMPLE], PRINT_OPTIONS, () => {})

    // One ~HS write may precede; count only label payloads.
    const labels = transport.writes.filter((w) => new TextDecoder().decode(w).startsWith('^XA'))
    expect(labels).toHaveLength(3)
  })

  it('reports progress after each label', async () => {
    const seen: number[] = []
    const { driver } = makeDriver({ encoding: 'hex' })
    await driver.connect()
    await driver.printPages([SAMPLE, SAMPLE], PRINT_OPTIONS, (n) => seen.push(n))
    expect(seen).toEqual([1, 2])
  })

  it('sets darkness once, on the first label only', async () => {
    const { driver, transport } = makeDriver({ encoding: 'hex' })
    await driver.connect()
    await driver.printPages([SAMPLE, SAMPLE], PRINT_OPTIONS, () => {})
    expect(sentText(transport).match(/\^MD/g)).toHaveLength(1)
  })

  it('reports an unreachable device rather than a generic failure', async () => {
    const transport = new FakeTransport({ failOnOpen: new Error('ECONNREFUSED') })
    const driver = new ZplDriver({ transport, address: '192.168.1.50:9100' })
    await expect(driver.connect()).rejects.toThrow(PrinterUnreachableError)
  })

  it('refuses to print when not connected', async () => {
    const { driver } = makeDriver()
    await expect(driver.printPages([SAMPLE], PRINT_OPTIONS, () => {})).rejects.toThrow(
      PrinterUnreachableError,
    )
  })

  it('releases the socket on disconnect', async () => {
    const { driver, transport } = makeDriver()
    await driver.connect()
    await driver.disconnect()
    expect(transport.closeCount).toBe(1)
  })
})

describe('host status', () => {
  it('reads the paper-out flag', () => {
    expect(parseHostStatus('\x02030,0,1,0,000,0,0,0,000,0,0,0\x03').paperOut).toBe(true)
  })

  it('reads a healthy printer as ready', () => {
    const status = parseHostStatus('\x02030,0,0,0,000,0,0,0,000,0,0,0\x03')
    expect(status.paperOut).toBe(false)
    expect(status.headUp).toBe(false)
  })

  it('treats unreadable output as nothing wrong', () => {
    // A status query that cannot be parsed must not become a print failure on
    // a printer that is actually fine.
    const status = parseHostStatus('garbage')
    expect(status.paperOut).toBe(false)
    expect(status.headUp).toBe(false)
  })

  it('blocks the job when the printer reports paper out', async () => {
    const transport = new FakeTransport({
      responses: [new TextEncoder().encode('\x02030,0,1,0,000,0,0,0,000,0,0,0\x03')],
    })
    const driver = new ZplDriver({ transport, address: '192.168.1.50:9100', statusTimeoutMs: 50 })
    await driver.connect()
    const result = await driver.preflight(1)
    expect(result.ok).toBe(false)
    expect(result.blockers).toContain(2)
  })

  it('proceeds when the printer says nothing at all', async () => {
    const { driver } = makeDriver()
    await driver.connect()
    expect((await driver.preflight(1)).ok).toBe(true)
  })
})
