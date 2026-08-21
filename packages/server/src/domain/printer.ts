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
}

const MM_PER_INCH = 25.4

/** Widest label this head can image, in millimetres (FR-005). */
export function maxLabelWidthMm(capabilities: ProbedCapabilities): number {
  return (capabilities.printheadPixels / capabilities.dpi) * MM_PER_INCH
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
