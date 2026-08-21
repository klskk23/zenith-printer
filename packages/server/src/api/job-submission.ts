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
  isVariableRef,
  labelIrSchema,
  renderBarcodeSvg,
  resolveVariables,
  sampleValues,
  type LabelIR,
} from '@zenith/shared'
import type { Database } from '../db/index.ts'
import { maxLabelWidthMm, type Printer } from '../domain/printer.ts'
import type { Profile } from '../domain/profile.ts'
import type { Template } from '../domain/template.ts'
import type { ContentSnapshot, SequenceRange } from '../domain/print-job.ts'
import { SequenceAllocator, SequenceOverflowError } from '../domain/sequence-allocator.ts'
import { ApiError } from './errors.ts'
import { DEFAULT_THRESHOLD } from '../render/binarize.ts'

export interface ResolvedContent {
  ir: LabelIR
  template: Template | null
  profile: Profile | null
}

/**
 * Values used to render the editor preview and to validate the design.
 * Sequence fields contribute their starting value; manual fields their sample.
 */
export function previewValues(template: Template | null): Record<string, string> {
  // The rule lives in @zenith/shared: the editor draws with these values and
  // this check measures with them, and the two disagreeing would be invisible
  // until a barcode reported as fitting turned out not to.
  return sampleValues(template?.variableFields ?? [])
}

/** Every manual field must have a value before anything is printed (FR-038). */
export function assertManualFieldsProvided(
  template: Template | null,
  provided: Record<string, string>,
): void {
  const missing = (template?.variableFields ?? [])
    .filter((field) => field.source === 'manual')
    .filter((field) => provided[field.name] === undefined || provided[field.name] === '')
    .map((field) => field.name)

  if (missing.length > 0) {
    throw ApiError.unprocessable('FIELD_VALIDATION_FAILED', { missingFields: missing })
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
  const resolved = resolveVariables(ir, values)

  for (const element of resolved.elements) {
    if (element.type !== 'barcode' && element.type !== 'qrcode') {
      continue
    }
    if (isVariableRef(element.content)) {
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
  content: ResolvedContent,
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
  }
}

export interface AllocateOptions {
  db: Database
  jobId: string
  template: Template | null
  copies: number
  overrides: Record<string, number>
}

/**
 * Claim sequence numbers for the job.
 * Last step in submission: an earlier rejection must not leave a claim behind,
 * because a claimed-then-abandoned range skips numbers for nothing.
 */
export function allocateSequences(options: AllocateOptions): Record<string, SequenceRange> {
  const { template } = options
  if (template === null || template.variableFields.every((f) => f.source !== 'sequence')) {
    return {}
  }

  try {
    return new SequenceAllocator(options.db).allocate({
      jobId: options.jobId,
      templateId: template.id,
      fields: template.variableFields,
      copies: options.copies,
      overrides: options.overrides,
    })
  } catch (err) {
    if (err instanceof SequenceOverflowError) {
      throw ApiError.unprocessable('SEQUENCE_OVERFLOW', {
        fieldName: err.fieldName,
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
