/**
 * Print profile: the settings that describe how a particular roll behaves on a
 * particular machine.
 *
 * Kept apart from templates on purpose. Swapping to thicker stock means
 * bumping the density and nudging the offset — and none of that should require
 * touching a design that was already correct (FR-027).
 */
import { z } from 'zod'
import { HALFTONE_MODES } from '../render/dither.ts'
import { DEFAULT_THRESHOLD } from '../render/binarize.ts'

/**
 * A profile describes the paper: its size, its margins, and how the machine
 * should be driven for it.
 *
 * Position correction is deliberately *not* here — it lives on the printer.
 * An offset describes where a machine currently lays ink down, which changes
 * whenever a roll is reloaded, even a roll of the identical type. Keeping it
 * here meant re-entering it per profile and having a profile switch silently
 * move the print.
 */
export const profileInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    density: z.number().int().min(1),
    labelType: z.number().int().min(1),
    speed: z.number().int().min(0).optional(),
    /**
     * How tone inside image elements is rendered.
     *
     * On the profile rather than on the printer or the label: it is a property
     * of the stock. The same logo wants a hard edge on a coated label and a
     * screen on rough paper, and the same design is printed on both.
     */
    halftone: z.enum(HALFTONE_MODES).default('none'),
    /**
     * The luminance below which a pixel becomes a print dot.
     *
     * 128 is the midpoint and the right answer for the black-on-white artwork
     * that most labels are. It matters when they are not: a pale grey logo sits
     * above it and prints as nothing at all, and a hairline is smeared to grey
     * by anti-aliasing and then erased. Raising it rescues both, at the cost of
     * fattening every stroke on the label.
     *
     * On the profile for the same reason as the halftone: what survives the
     * threshold depends on the stock.
     */
    threshold: z.number().int().min(1).max(255).default(DEFAULT_THRESHOLD),
    /** Stock dimensions. The canvas follows these when the profile is chosen. */
    labelWidthMm: z.number().finite().positive(),
    labelHeightMm: z.number().finite().positive(),
    /**
     * Advisory, not a boundary: the editor shades these but never refuses to
     * place anything in them. Someone printing deliberately close to the edge
     * has a reason.
     */
    marginTopMm: z.number().finite().min(0).default(0),
    marginRightMm: z.number().finite().min(0).default(0),
    marginBottomMm: z.number().finite().min(0).default(0),
    marginLeftMm: z.number().finite().min(0).default(0),
    isDefault: z.boolean().default(false),
  })
  .refine((input) => input.marginLeftMm + input.marginRightMm < input.labelWidthMm, {
    message: 'horizontal margins leave no printable width',
    path: ['marginLeftMm'],
  })
  .refine((input) => input.marginTopMm + input.marginBottomMm < input.labelHeightMm, {
    message: 'vertical margins leave no printable height',
    path: ['marginTopMm'],
  })
export type ProfileInput = z.infer<typeof profileInputSchema>

export interface Profile extends ProfileInput {
  id: string
  printerId: string
  createdAt: string
}
