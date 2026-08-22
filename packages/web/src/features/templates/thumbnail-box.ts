/**
 * How big to draw a design's thumbnail beside its title.
 *
 * A single fixed frame does not work here, because labels are not one shape.
 * A 100 x 10 mm strip letterboxed into a square is a hairline with empty space
 * above and below it; a 30 x 50 mm portrait label in the same square is a
 * sliver. The frame has to take the shape of the label — that is the only way
 * a glance at the card tells you which way round the design is.
 *
 * So: contain the label's own proportions inside a budget, and let one of the
 * two limits bind. Wide designs use the full width and come out short; tall
 * ones use the full height and come out narrow.
 */
export interface BoxLimits {
  maxWidthPx: number
  maxHeightPx: number
}

export interface BoxPx {
  widthPx: number
  heightPx: number
}

/** Never smaller than this, or an extreme ratio collapses to an invisible line. */
const MIN_EXTENT_PX = 12

/**
 * The largest box with the label's proportions that fits inside the limits.
 *
 * Rounded to whole pixels: a fractional frame beside a line of text lands on
 * half a device pixel and blurs the border by exactly the amount that makes it
 * look like a rendering fault.
 */
export function thumbnailBoxPx(
  label: { widthMm: number; heightMm: number },
  limits: BoxLimits,
): BoxPx {
  // Degenerate input cannot reach here through the schema, which requires both
  // to be positive — but a box of NaN would take the whole card down with it.
  if (!(label.widthMm > 0) || !(label.heightMm > 0)) {
    return { widthPx: limits.maxHeightPx, heightPx: limits.maxHeightPx }
  }

  const scale = Math.min(limits.maxWidthPx / label.widthMm, limits.maxHeightPx / label.heightMm)
  return {
    widthPx: Math.max(MIN_EXTENT_PX, Math.round(label.widthMm * scale)),
    heightPx: Math.max(MIN_EXTENT_PX, Math.round(label.heightMm * scale)),
  }
}
