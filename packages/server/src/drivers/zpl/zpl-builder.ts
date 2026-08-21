/**
 * ZPL generation for Honeywell printers running ZSim.
 *
 * ZSim emulates ZPL II rather than implementing it, so the safe subset is the
 * one to use: a whole-label graphic field and nothing clever. The first version
 * deliberately sends one `^GF` per label instead of native `^BC` barcodes and
 * `^A` text — that keeps a single render path shared with the NIIMBOT side, and
 * leaves exactly one thing to verify against real hardware ("does the image
 * land in the right place") instead of a dozen font and symbology quirks.
 *
 * Two encodings are produced because whether ZSim accepts the compressed one
 * is an open question (hardware verification #4). Plain hex always works and
 * costs four bytes per byte; Z64 is typically 10-20x smaller on label art.
 */
import { deflateSync } from 'node:zlib'
import type { BinaryBitmap } from '../port.ts'

export type GraphicEncoding = 'hex' | 'z64'

export interface ZplLabelOptions {
  /** Copies of this label. `^PQ`. */
  copies?: number
  /** Print darkness, mapped from the profile's density. `^MD`. */
  darkness?: number
  /** Origin offset in dots. Offsets are normally applied to the bitmap
   *  instead, so this stays at zero; it exists for diagnostics. */
  originXDots?: number
  originYDots?: number
  encoding?: GraphicEncoding
}

/**
 * CRC-16/CCITT-FALSE over the encoded payload, which is what `:Z64:` requires
 * after the data. Zebra's own documentation calls it "the CRC" and leaves the
 * variant implicit; this is the one their firmware accepts.
 */
export function crc16(data: string): number {
  let crc = 0x0000
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

export interface GraphicField {
  /** Total bytes in the uncompressed bitmap. */
  totalBytes: number
  bytesPerRow: number
  /** The `a` parameter of `^GF`: A for ASCII hex, B for binary. */
  format: 'A' | 'B'
  data: string
}

/** Rows are already byte-aligned by the binariser; this mirrors that layout. */
function bytesPerRow(bitmap: BinaryBitmap): number {
  return Math.ceil(bitmap.widthDots / 8)
}

/** Uppercase hex, which is what ZPL expects for `^GFA`. */
export function toHexData(bitmap: BinaryBitmap): GraphicField {
  const perRow = bytesPerRow(bitmap)
  let data = ''
  for (const byte of bitmap.data) {
    data += byte.toString(16).padStart(2, '0').toUpperCase()
  }
  return { totalBytes: bitmap.data.length, bytesPerRow: perRow, format: 'A', data }
}

/**
 * `:Z64:<base64 of zlib deflate>:<crc>`.
 *
 * Still an `^GFA` field: the `A` describes the outer ASCII framing, and the
 * `:Z64:` prefix tells the firmware the payload inside is compressed.
 */
export function toZ64Data(bitmap: BinaryBitmap): GraphicField {
  const compressed = deflateSync(Buffer.from(bitmap.data)).toString('base64')
  const payload = `:Z64:${compressed}`
  return {
    totalBytes: bitmap.data.length,
    bytesPerRow: bytesPerRow(bitmap),
    format: 'A',
    data: `${payload}:${crc16(compressed).toString(16).padStart(4, '0')}`,
  }
}

export function encodeGraphic(bitmap: BinaryBitmap, encoding: GraphicEncoding): GraphicField {
  return encoding === 'z64' ? toZ64Data(bitmap) : toHexData(bitmap)
}

/** One complete label: `^XA` … `^XZ`. */
export function buildLabel(bitmap: BinaryBitmap, options: ZplLabelOptions = {}): string {
  const graphic = encodeGraphic(bitmap, options.encoding ?? 'z64')
  const x = options.originXDots ?? 0
  const y = options.originYDots ?? 0

  const parts = ['^XA']

  if (options.darkness !== undefined) {
    parts.push(`^MD${options.darkness}`)
  }

  // ^LH0,0 pins label home so the bitmap's own coordinates are the only thing
  // positioning content. Offsets are applied to the bitmap instead, which keeps
  // both printer types behaving identically and lets the editor preview them.
  parts.push('^LH0,0')
  parts.push(`^FO${x},${y}`)
  parts.push(
    `^GF${graphic.format},${graphic.totalBytes},${graphic.totalBytes},${graphic.bytesPerRow},${graphic.data}`,
  )
  parts.push('^FS')

  if (options.copies !== undefined && options.copies > 1) {
    parts.push(`^PQ${options.copies}`)
  }

  parts.push('^XZ')
  return parts.join('')
}

/** Host status query. The only status channel ZSim offers. */
export const HOST_STATUS_QUERY = '~HS'

export interface HostStatus {
  paperOut: boolean
  paused: boolean
  headUp: boolean
  ribbonOut: boolean
  raw: string
}

/**
 * Parse a `~HS` reply.
 *
 * The response is three comma-separated lines wrapped in STX/ETX. Only a few
 * flags matter here, and unparseable input reports "nothing wrong" rather than
 * throwing: a status query that cannot be read must not become a print failure
 * on a printer that is actually fine.
 */
export function parseHostStatus(raw: string): HostStatus {
  // STX and ETX are the framing the protocol specifies, not stray control
  // characters, so the rule is disabled here rather than the pattern reworked.
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\x02\x03\r\n]/g, ' ').trim()
  const fields = clean.split(',')

  const flag = (index: number): boolean => fields[index]?.trim() === '1'

  return {
    // Field positions per the ZPL host status format.
    paperOut: flag(2),
    paused: flag(3),
    headUp: flag(10),
    ribbonOut: flag(11),
    raw: clean,
  }
}
