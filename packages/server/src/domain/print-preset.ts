/**
 * A print preset: design, printer, settings and count, under a name.
 *
 * What it is *for* is the thing worth stating. Printing a label from another
 * system otherwise means that system knowing which template, which printer,
 * which print profile and how many copies — four decisions that belong to
 * whoever is standing in front of the machine, and that change when a printer
 * is replaced or a design is revised. A preset is one stable id instead, and
 * every one of those four can be changed here without the other side noticing.
 */
import { z } from 'zod'

export const presetNameSchema = z.string().trim().min(1).max(60)

export const printPresetInputSchema = z.object({
  name: presetNameSchema,
  templateId: z.string().min(1),
  printerId: z.string().min(1),
  profileId: z.string().min(1).nullish(),
  /**
   * Copies of every row, not labels in total.
   *
   * The ceiling is checked against rows x copies at submission, the same as any
   * other job — a preset is not a way around the batch limit.
   */
  copies: z.number().int().min(1).max(100).default(1),
})
export type PrintPresetInput = z.infer<typeof printPresetInputSchema>

/**
 * Written out rather than derived with `.partial()`.
 *
 * `.partial()` makes a key optional but leaves its `.default()` in place, and a
 * default fires precisely when the key is absent — which is what a patch means
 * by "leave this alone". So renaming a preset also reset its copies to one, and
 * the next batch printed a third of the labels somebody expected with nothing
 * in the response saying so.
 *
 * Every field here is optional and none carries a default, so an absent key
 * changes nothing. `profileId` still accepts an explicit `null`: "move it back
 * to the printer's own settings" is a different instruction from "do not
 * mention it", and a patch that cannot say the first makes that choice
 * one-way.
 */
export const printPresetPatchSchema = z.object({
  name: presetNameSchema.optional(),
  templateId: z.string().min(1).optional(),
  printerId: z.string().min(1).optional(),
  profileId: z.string().min(1).nullish(),
  copies: z.number().int().min(1).max(100).optional(),
})
export type PrintPresetPatch = z.infer<typeof printPresetPatchSchema>

export interface PrintPreset {
  id: string
  name: string
  templateId: string
  printerId: string
  profileId: string | null
  copies: number
  createdAt: string
  updatedAt: string
}
