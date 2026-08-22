/**
 * Label template.
 *
 * Bound to a printer *kind*, not an instance, so two identical machines share
 * one template. Deliberately not bound to a profile: that separation is what
 * lets someone switch to thicker stock and bump the density without touching
 * a single design (FR-027, FR-031).
 */
import { z } from 'zod'
import { labelElementSchema, variableDefinitionsSchema } from '@zenith/shared'
import { isSequenceVariable, type VariableDefinition } from '@zenith/shared'
import { printerKindSchema } from './printer.ts'

export const templateNameSchema = z.string().trim().min(1).max(80)

export const templateInputSchema = z.object({
  name: templateNameSchema,
  printerKind: printerKindSchema,
  widthMm: z.number().finite().positive(),
  heightMm: z.number().finite().positive(),
  dpi: z.number().int().positive(),
  elements: z.array(labelElementSchema),
  /** Constants and sequences. Data source columns are not declared here. */
  variables: variableDefinitionsSchema,
  /**
   * The one data source this design draws rows from, by id.
   *
   * A column rather than something parsed out of element content: that is what
   * makes "at most one data source" impossible to express rather than a rule
   * somebody has to remember to check. A dangling id after the source is
   * deleted is a visible state, not an error — see `bindingIssue`.
   */
  dataSourceId: z.string().min(1).nullable().default(null),
})
export type TemplateInput = z.infer<typeof templateInputSchema>

export interface Template extends TemplateInput {
  id: string
  createdAt: string
  updatedAt: string
  /**
   * Optimistic concurrency token: a stale value means somebody else saved first.
   *
   * A counter rather than `updatedAt`, which is what this used to be. Two saves
   * that land on the same timestamp compare equal, so the second one overwrites
   * the first *and reports success* — the precise failure the token exists to
   * prevent. Under an injected fixed clock that is not a rare race but the
   * normal case, which is also why no existing test caught it.
   */
  version: number
  /**
   * Whether a library thumbnail was generated for this design.
   *
   * A flag rather than the bytes: the list returns every template, and inlining
   * a picture per row would make the common request tens of times larger for
   * data most of it is not going to draw. The bytes come from
   * `GET /api/templates/:id/thumbnail`, which the browser can cache.
   *
   * False when the design could not be drawn — an unencodable barcode, say.
   * Losing the save over its picture would be the wrong trade.
   */
  hasThumbnail: boolean
}

export class TemplateConflictError extends Error {
  readonly templateId: string
  readonly currentVersion: number

  constructor(templateId: string, currentVersion: number) {
    super(`template ${templateId} was modified by someone else`)
    this.name = 'TemplateConflictError'
    this.templateId = templateId
    this.currentVersion = currentVersion
  }
}

/** Sequence variables of a design, which are the ones that claim numbers. */
export function sequenceVariables(template: Template): Extract<VariableDefinition, { kind: 'sequence' }>[] {
  return template.variables.filter(isSequenceVariable)
}
