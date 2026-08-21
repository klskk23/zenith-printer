/**
 * Print profile: the settings that describe how a particular roll behaves on a
 * particular machine.
 *
 * Kept apart from templates on purpose. Swapping to thicker stock means
 * bumping the density and nudging the offset — and none of that should require
 * touching a design that was already correct (FR-027).
 */
import { z } from 'zod'

export const profileInputSchema = z.object({
  name: z.string().min(1).max(80),
  density: z.number().int().min(1),
  labelType: z.number().int().min(1),
  speed: z.number().int().min(0).optional(),
  /**
   * Stored in millimetres; the UI steps in dots, because that is the machine's
   * actual resolution and nobody should type multiples of 0.125mm (FR-029).
   */
  offsetXMm: z.number().finite().default(0),
  offsetYMm: z.number().finite().default(0),
  isDefault: z.boolean().default(false),
})
export type ProfileInput = z.infer<typeof profileInputSchema>

export interface Profile extends ProfileInput {
  id: string
  printerId: string
  createdAt: string
}
