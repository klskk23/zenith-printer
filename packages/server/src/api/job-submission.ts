/**
 * Job submission logic.
 *
 * Extracted from the route because this is where the expensive mistakes get
 * caught, and it deserves to be readable and testable on its own. Everything
 * here runs **before a single label is burned** — which is the whole point of
 * FR-015, FR-040 and FR-046 sharing that same wording.
 *
 * Order matters: cheap structural checks first, then the ones that need the
 * device, then the sequence claim last, so a rejected job never leaves a
 * claimed range behind.
 */
import {
  collectReferences,
  detectNameCollisions,
  evaluateIr,
  labelIrSchema,
  renderBarcodeSvg,
  type LabelIR,
} from '@zenith/shared'
import type { Database } from '../db/index.ts'
import type { Clock, IdGenerator } from '../clock.ts'
import { maxLabelWidthMm, type Printer } from '../domain/printer.ts'
import type { Profile } from '../domain/profile.ts'
import type { Template } from '../domain/template.ts'
import type { ContentSnapshot, SequenceClaim } from '../domain/print-job.ts'
import { SequenceAllocator, SequenceOverflowError } from '../domain/sequence-allocator.ts'
import { ApiError } from './errors.ts'
import { DEFAULT_THRESHOLD } from '../render/binarize.ts'

export interface ResolvedContent {
  ir: LabelIR
  template: Template | null
  profile: Profile | null
}

/**
 * Values the design's own variables contribute — constants directly, sequences
 * as a placeholder of the right width.
 *
 * The editor draws with these and this module measures with them. Two
 * different answers would be invisible until a barcode reported as fitting
 * turned out not to.
 */
export function constantValues(template: Template | null): Record<string, string> {
  const values: Record<string, string> = {}
  for (const variable of template?.variables ?? []) {
    if (variable.kind === 'constant') {
      values[variable.name] = variable.value
    }
  }
  return values
}

export function designValues(
  template: Template | null,
  sequenceStarts: Record<string, { value: number; digits: number }> = {},
): Record<string, string> {
  const values = constantValues(template)
  for (const variable of template?.variables ?? []) {
    if (variable.kind !== 'sequence') continue
    const start = sequenceStarts[variable.name]
    values[variable.name] =
      start === undefined ? '0' : String(start.value).padStart(start.digits, '0')
  }
  return values
}

/**
 * Every closed reference must resolve before anything is printed.
 *
 * Unresolvable content is not a rendering problem to be discovered later: the
 * label would come out reading "${sku}", which is waste that looks like output.
 */
export function assertReferencesResolvable(ir: LabelIR, values: Record<string, string>): void {
  const unresolved = collectReferences(ir).filter((name) => values[name] === undefined)
  if (unresolved.length > 0) {
    throw ApiError.unprocessable('VARIABLE_NOT_DEFINED', {
      reference: unresolved[0],
      references: unresolved,
    })
  }
}

/**
 * A design variable and a column of the bound source must not share a name.
 *
 * Refused rather than resolved by precedence: a precedence rule would let
 * somebody change what an existing label prints by adding a column, without
 * any way for them to know what they shadowed (FR-009b).
 */
export function assertNoNameCollisions(template: Template | null, columns: readonly string[]): void {
  const collisions = detectNameCollisions(template?.variables ?? [], columns)
  if (collisions.length > 0) {
    throw ApiError.unprocessable('VARIABLE_NAME_COLLIDES', { name: collisions[0], names: collisions })
  }
}

/**
 * Check every barcode encodes, using the values this job will actually print.
 *
 * A barcode that a symbology cannot express produces a label that looks
 * plausible and will not scan, discovered only when somebody points a reader
 * at it (FR-040).
 */
export function assertBarcodesEncodable(ir: LabelIR, values: Record<string, string>): void {
  const resolved = evaluateIr(ir, values).ir

  for (const element of resolved.elements) {
    if (element.type !== 'barcode' && element.type !== 'qrcode') {
      continue
    }
    try {
      renderBarcodeSvg({
        symbology: element.type === 'qrcode' ? 'code128' : element.symbology,
        content: element.content,
        heightDots: 40,
      })
    } catch (err) {
      throw ApiError.unprocessable('FIELD_VALIDATION_FAILED', {
        elementId: element.id,
        content: element.content,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/** Canvas must fit the head, or its right edge is lost with no error (FR-005). */
export function assertFitsPrinter(ir: LabelIR, printer: Printer): void {
  const capabilities = printer.capabilities
  if (capabilities === null) {
    throw ApiError.unprocessable('VALIDATION_FAILED', { printerId: printer.id })
  }
  const limit = maxLabelWidthMm(capabilities)
  if (ir.widthMm > limit + 1e-6) {
    throw ApiError.unprocessable('FIELD_VALIDATION_FAILED', {
      widthMm: ir.widthMm,
      maxLabelWidthMm: Number(limit.toFixed(3)),
    })
  }
}

/** A design for one printer kind has no meaning on another (FR-032). */
export function assertTemplateMatchesPrinter(template: Template, printer: Printer): void {
  if (template.printerKind !== printer.kind) {
    throw ApiError.unprocessable('TEMPLATE_PRINTER_MISMATCH', {
      templateKind: template.printerKind,
      printerKind: printer.kind,
    })
  }
}

/**
 * Build the self-contained record of what is about to be printed.
 * Copied rather than referenced, so later edits and deletions cannot rewrite
 * history (FR-050).
 */
export function buildSnapshot(
  printer: Printer,
  content: ResolvedContent & { rows: Array<Record<string, string>>; copiesPerRow: number },
): ContentSnapshot {
  const capabilities = printer.capabilities
  if (capabilities === null) {
    throw ApiError.unprocessable('VALIDATION_FAILED', { printerId: printer.id })
  }
  const { ir, template, profile } = content

  return {
    templateName: template?.name ?? null,
    printerName: printer.name,
    printerModel: capabilities.model,
    printerKind: printer.kind,
    widthMm: ir.widthMm,
    heightMm: ir.heightMm,
    dpi: ir.dpi,
    ir,
    profile: {
      name: profile?.name ?? null,
      // No profile chosen: fall back to what the device reported about itself.
      density: profile?.density ?? capabilities.densityDefault,
      labelType: profile?.labelType ?? capabilities.paperTypes[0] ?? 1,
      halftone: profile?.halftone ?? 'none',
      threshold: profile?.threshold ?? DEFAULT_THRESHOLD,
    },
    // Taken from the printer, which is where correction now lives; captured
    // here because it will have changed by the time anyone reads this record.
    offsetXDots: printer.offsetXDots,
    offsetYDots: printer.offsetYDots,
    rows: content.rows,
    copiesPerRow: content.copiesPerRow,
    constants: constantValues(template),
  }
}

export interface AllocateOptions {
  db: Database
  clock: Clock
  ids: IdGenerator
  jobId: string
  template: Template | null
  /** Distinct serials needed: rows when there is a data source, else copies. */
  count: number
}

/**
 * Claim sequence numbers for the job.
 * Last step in submission: an earlier rejection must not leave a claim behind,
 * because a claimed-then-abandoned range skips numbers for nothing.
 */
export function allocateSequences(options: AllocateOptions): SequenceClaim[] {
  const bindings = (options.template?.variables ?? [])
    .filter((variable) => variable.kind === 'sequence')
    .map((variable) => ({ variableName: variable.name, poolId: variable.poolId }))

  if (bindings.length === 0) {
    return []
  }

  try {
    return new SequenceAllocator(options.db, options.clock, options.ids).allocate({
      jobId: options.jobId,
      bindings,
      count: options.count,
    })
  } catch (err) {
    if (err instanceof SequenceOverflowError) {
      throw ApiError.unprocessable('SEQUENCE_OVERFLOW', {
        poolName: err.poolName,
        requestedEnd: err.requestedEnd,
        maxValue: err.maxValue,
      })
    }
    throw err
  }
}

/**
 * The label to print, and where it came from.
 *
 * A submitted IR wins over the template's stored elements. The two are only
 * both present when the editor has a template open, and in that case the
 * design on screen is the one the operator is looking at and expects to get.
 * The template is still returned alongside: it supplies the variable fields
 * the sequence allocator claims from, and the identity the job is filed under,
 * so history still says which template this batch belongs to.
 *
 * The stored elements are used when no IR is sent at all — "print template X",
 * without holding its contents.
 */
export function resolveContent(
  template: Template | null,
  adHocIr: unknown,
  profile: Profile | null,
): ResolvedContent {
  const ir =
    adHocIr !== undefined
      ? labelIrSchema.parse(adHocIr)
      : labelIrSchema.parse({
          widthMm: template?.widthMm,
          heightMm: template?.heightMm,
          dpi: template?.dpi,
          elements: template?.elements,
        })
  return { ir, template, profile }
}
