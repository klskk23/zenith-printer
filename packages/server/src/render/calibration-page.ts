/**
 * Calibration label.
 *
 * Printed, measured by hand, and the measurement typed back in. There is no way
 * to detect the offset automatically — nothing reads the paper back — so the
 * label has to be legible enough to measure with a ruler or by eye.
 *
 * The design follows from that: a cross at the exact centre of the stock, and
 * ticks along each edge at known spacing. If the cross is 2 mm above centre,
 * the print is landing 2 mm high and the correction is "down 2 mm".
 *
 * Built as ordinary label IR rather than a special render path, so it goes
 * through the same pipeline as any other label — including the offset being
 * corrected, which is what makes "print it again to check" work.
 */
import { labelIrSchema, type LabelIR } from '@zenith/shared'

/** Ticks every 5 mm, with a longer one every 10 mm. */
const TICK_STEP_MM = 5
const SHORT_TICK_MM = 1.5
const LONG_TICK_MM = 3
const CROSS_ARM_MM = 4

export interface CalibrationPageOptions {
  widthMm: number
  heightMm: number
  dpi: number
  /** Rules are one dot: the thinnest mark that survives thresholding. */
  strokeWidthDots?: number
}

export function calibrationPageIr(options: CalibrationPageOptions): LabelIR {
  const { widthMm, heightMm, dpi } = options
  const stroke = options.strokeWidthDots ?? 1
  const elements: unknown[] = []
  let n = 0
  const id = (): string => `cal-${(n += 1)}`

  const centreX = widthMm / 2
  const centreY = heightMm / 2

  // Centre cross — the thing being measured against.
  elements.push({
    id: id(), type: 'line',
    xMm: centreX - CROSS_ARM_MM, yMm: centreY, x2Mm: centreX + CROSS_ARM_MM, y2Mm: centreY,
    strokeWidthDots: stroke,
  })
  elements.push({
    id: id(), type: 'line',
    xMm: centreX, yMm: centreY - CROSS_ARM_MM, x2Mm: centreX, y2Mm: centreY + CROSS_ARM_MM,
    strokeWidthDots: stroke,
  })

  // A border, so a shift shows up as an uneven margin even without measuring.
  elements.push({
    id: id(), type: 'rect',
    xMm: 0, yMm: 0, widthMm, heightMm,
    strokeWidthDots: stroke, filled: false, cornerRadiusMm: 0,
  })

  // Edge ticks. Position is what is being measured, so they start from the
  // edges rather than from the centre.
  for (let mm = TICK_STEP_MM; mm < widthMm; mm += TICK_STEP_MM) {
    const length = mm % (TICK_STEP_MM * 2) === 0 ? LONG_TICK_MM : SHORT_TICK_MM
    elements.push({ id: id(), type: 'line', xMm: mm, yMm: 0, x2Mm: mm, y2Mm: length, strokeWidthDots: stroke })
    elements.push({
      id: id(), type: 'line',
      xMm: mm, yMm: heightMm - length, x2Mm: mm, y2Mm: heightMm,
      strokeWidthDots: stroke,
    })
  }
  for (let mm = TICK_STEP_MM; mm < heightMm; mm += TICK_STEP_MM) {
    const length = mm % (TICK_STEP_MM * 2) === 0 ? LONG_TICK_MM : SHORT_TICK_MM
    elements.push({ id: id(), type: 'line', xMm: 0, yMm: mm, x2Mm: length, y2Mm: mm, strokeWidthDots: stroke })
    elements.push({
      id: id(), type: 'line',
      xMm: widthMm - length, yMm: mm, x2Mm: widthMm, y2Mm: mm,
      strokeWidthDots: stroke,
    })
  }

  return labelIrSchema.parse({ widthMm, heightMm, dpi, elements })
}
