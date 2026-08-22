/**
 * Printer entity.
 *
 * Split by provenance: the address and command language are typed in, because
 * they answer "how do I find it and how do I talk to it"; everything else is
 * probed, because it answers "what is it".
 *
 * Constitution ("Hardware compatibility"): model-specific numbers are read from
 * probed metadata and never hardcoded. Every limit below is derived, so adding
 * a printer with a different head width needs no code change.
 */
import { z } from 'zod'

export const printerKindSchema = z.enum(['niimbot', 'zpl'])
export type PrinterKind = z.infer<typeof printerKindSchema>

export const transportKindSchema = z.enum(['serial', 'tcp'])
export type TransportKind = z.infer<typeof transportKindSchema>

export const queueStateSchema = z.enum(['running', 'paused'])
export type QueueState = z.infer<typeof queueStateSchema>

/** Fields the operator supplies when adding a printer (FR-024). */
export const printerInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    kind: printerKindSchema,
    transport: transportKindSchema,
    address: z.string().min(1),
    /**
     * Detection via `getPrintTaskType()` is unreliable, so this is chosen by
     * hand. B3S_P uses `B1`. There is no `P1`.
     */
    printTaskName: z.string().min(1).optional(),
  })
  .refine((input) => input.kind !== 'niimbot' || input.printTaskName !== undefined, {
    message: 'printTaskName is required for niimbot printers',
    path: ['printTaskName'],
  })
export type PrinterInput = z.infer<typeof printerInputSchema>

/** Everything discovered by probing. Absent until the first successful probe. */
export interface ProbedCapabilities {
  dpi: number
  printheadPixels: number
  densityMin: number
  densityMax: number
  densityDefault: number
  paperTypes: number[]
  printDirection: 'top' | 'left'
  supportsConsumableLevel: boolean
  model: string | null
  serial: string | null
  firmwareVersion: string | null
}

export interface Printer extends PrinterInput {
  id: string
  capabilities: ProbedCapabilities | null
  queueState: QueueState
  queuePausedReason: string | null
  lastProbedAt: string | null
  createdAt: string
  /**
   * Position correction, in **dots**.
   *
   * The only position in this system not stored in millimetres, and
   * deliberately so: an offset translates the whole bitmap, and the natural
   * granularity of that is the print dot. Going via millimetres would round
   * twice for no gain.
   *
   * It belongs to the machine, not to the paper. Reloading a roll — even one of
   * the identical type — can shift where the paper sits, so this is expected to
   * be re-measured after a paper change (FR-052, FR-057).
   *
   * Positive x moves right, positive y moves down.
   */
  offsetXDots: number
  offsetYDots: number
}

/**
 * An offset larger than the head pushes every dot off the paper.
 *
 * Rejected rather than clamped: a silently clamped offset looks like the
 * correction was accepted and did nothing.
 */
export function isOffsetWithinHead(
  offset: { offsetXDots: number; offsetYDots: number },
  capabilities: ProbedCapabilities | null,
): boolean {
  if (capabilities === null) {
    return true
  }
  return (
    Math.abs(offset.offsetXDots) < capabilities.printheadPixels &&
    Math.abs(offset.offsetYDots) < capabilities.printheadPixels
  )
}

const MM_PER_INCH = 25.4

/** Widest label this head can image, in millimetres (FR-005). */
export function maxLabelWidthMm(capabilities: ProbedCapabilities): number {
  return (capabilities.printheadPixels / capabilities.dpi) * MM_PER_INCH
}

/**
 * The design at the resolution of the printer it is going to.
 *
 * A label design is millimetres and content. The dot grid it lands on belongs
 * to the printer, so the dpi carried by a stored template — or by the editor,
 * which uses whatever this browser prefers — is a *preview* value and must not
 * survive into the render.
 *
 * It used to. A template saved against a 203 dpi head and sent to a 300 dpi one
 * was rasterised at 203 and printed about two thirds of its intended size, and
 * the only way out was to open the design and save it again. Nothing about the
 * label had changed; only the machine had.
 *
 * One thing does move with the dpi, deliberately: a barcode's module width is
 * stored in *dots*, so the same barcode is physically narrower on a finer head.
 * The alternative — holding its millimetres and letting the module fall on a
 * fractional dot — gives uneven bars that a scanner may refuse, and a barcode
 * that cannot be read is worse than one that is smaller than intended. It can
 * only ever shrink, so it cannot overflow the label; `checkLabel` runs against
 * this dpi and would say so if it could.
 */
export function atPrinterDpi<T extends { dpi: number }>(ir: T, capabilities: ProbedCapabilities): T {
  return ir.dpi === capabilities.dpi ? ir : { ...ir, dpi: capabilities.dpi }
}

/**
 * Thinnest visible stroke, in millimetres (FR-008).
 * At 203 dpi this is 0.125mm; anything below it is anti-aliased to grey and
 * then removed by thresholding, so the label silently loses the line.
 */
export function minStrokeWidthMm(capabilities: ProbedCapabilities): number {
  return MM_PER_INCH / capabilities.dpi
}

export class PrinterNotProbedError extends Error {
  readonly printerId: string

  constructor(printerId: string) {
    super(`printer ${printerId} has not been probed yet`)
    this.name = 'PrinterNotProbedError'
    this.printerId = printerId
  }
}

/** Capabilities of a probed printer, or a typed failure. */
export function requireCapabilities(printer: Printer): ProbedCapabilities {
  if (printer.capabilities === null) {
    throw new PrinterNotProbedError(printer.id)
  }
  return printer.capabilities
}

/** Whether a density value is within what this model accepts. */
export function isDensityInRange(capabilities: ProbedCapabilities, density: number): boolean {
  return (
    Number.isInteger(density) &&
    density >= capabilities.densityMin &&
    density <= capabilities.densityMax
  )
}

/** Whether a template designed for `kind` can run on this printer (FR-032). */
export function acceptsTemplateKind(printer: Printer, kind: PrinterKind): boolean {
  return printer.kind === kind
}
