/**
 * Label template.
 *
 * Bound to a printer *kind*, not an instance, so two identical machines share
 * one template. Deliberately not bound to a profile: that separation is what
 * lets someone switch to thicker stock and bump the density without touching
 * a single design (FR-027, FR-031).
 */
import { z } from 'zod'
import { labelElementSchema } from '@zenith/shared'
import { printerKindSchema } from './printer.ts'
import { variableFieldSchema, type VariableField } from './variable-field.ts'

export const templateInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    printerKind: printerKindSchema,
    widthMm: z.number().finite().positive(),
    heightMm: z.number().finite().positive(),
    dpi: z.number().int().positive(),
    elements: z.array(labelElementSchema),
    variableFields: z.array(variableFieldSchema).default([]),
  })
  .refine(
    (input) => new Set(input.variableFields.map((f) => f.name)).size === input.variableFields.length,
    { message: 'variable field names must be unique within a template', path: ['variableFields'] },
  )
export type TemplateInput = z.infer<typeof templateInputSchema>

export interface Template extends TemplateInput {
  id: string
  createdAt: string
  /** Optimistic concurrency token: a stale value means somebody else saved first. */
  updatedAt: string
}

export class TemplateConflictError extends Error {
  readonly templateId: string
  readonly currentUpdatedAt: string

  constructor(templateId: string, currentUpdatedAt: string) {
    super(`template ${templateId} was modified by someone else`)
    this.name = 'TemplateConflictError'
    this.templateId = templateId
    this.currentUpdatedAt = currentUpdatedAt
  }
}

/** Fields the print form must collect before a job can be submitted (FR-038). */
export function requiredManualFields(template: Template): VariableField[] {
  return template.variableFields.filter((field) => field.source === 'manual')
}

export function sequenceFields(template: Template): VariableField[] {
  return template.variableFields.filter((field) => field.source === 'sequence')
}
