/**
 * Variable definitions carried by a design.
 *
 * Only two kinds live here. Data source columns are deliberately absent: they
 * need no declaration, because the design already names the table it is bound
 * to and the column name is the reference itself.
 */
import { z } from 'zod'

/** Any character but `}`; `}` would close the reference (FR-009a). */
const variableNameSchema = z
  .string()
  .transform((name) => name.trim())
  .refine((name) => name.length > 0, { message: 'variable name must not be empty' })
  .refine((name) => !name.includes('}'), { message: 'variable name must not contain "}"' })
  .refine((name) => name.length <= 60, { message: 'variable name must be at most 60 characters' })

export const variableDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({ name: variableNameSchema, kind: z.literal('constant'), value: z.string().max(500) }),
  z.object({ name: variableNameSchema, kind: z.literal('sequence'), poolId: z.string().min(1) }),
])
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>

export const variableDefinitionsSchema = z
  .array(variableDefinitionSchema)
  .default([])
  .refine((defs) => new Set(defs.map((d) => d.name)).size === defs.length, {
    message: 'variable names must be unique within a design',
  })

export function isSequenceVariable(
  definition: VariableDefinition,
): definition is Extract<VariableDefinition, { kind: 'sequence' }> {
  return definition.kind === 'sequence'
}
