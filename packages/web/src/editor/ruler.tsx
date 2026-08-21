/**
 * Rulers.
 *
 * Both axes. The original sketch only had a horizontal one, but vertical
 * placement needs the same reference.
 *
 * Major ticks are millimetres, minor ticks subdivide toward dots — at 203 dpi
 * one millimetre is about eight dots, which is a comfortable density. The tick
 * spacing adapts to the zoom so a zoomed-out ruler does not turn into a solid
 * grey bar.
 */
import { useMemo } from 'react'
import { mmToDots } from '@zenith/shared'

const RULER_THICKNESS = 18

/** Millimetres between labelled ticks, chosen so they stay readable. */
function majorStepMm(pixelsPerMm: number): number {
  for (const step of [1, 2, 5, 10, 20, 50]) {
    if (step * pixelsPerMm >= 40) {
      return step
    }
  }
  return 100
}

export interface RulerProps {
  lengthMm: number
  dpi: number
  /** Screen pixels per printer dot. */
  zoom: number
  orientation: 'horizontal' | 'vertical'
}

export function Ruler({ lengthMm, dpi, zoom, orientation }: RulerProps): React.JSX.Element {
  const pixelsPerMm = (mmToDots(1, dpi) || 1) * zoom
  const lengthPx = mmToDots(lengthMm, dpi) * zoom
  const horizontal = orientation === 'horizontal'

  const ticks = useMemo(() => {
    const major = majorStepMm(pixelsPerMm)
    const minor = major / 5
    const out: { mm: number; isMajor: boolean }[] = []
    for (let mm = 0; mm <= lengthMm + 1e-9; mm += minor) {
      const rounded = Math.round(mm * 1000) / 1000
      out.push({ mm: rounded, isMajor: Math.abs(rounded % major) < 1e-6 })
    }
    return out
  }, [lengthMm, pixelsPerMm])

  return (
    <svg
      width={horizontal ? lengthPx : RULER_THICKNESS}
      height={horizontal ? RULER_THICKNESS : lengthPx}
      className="shrink-0 text-muted-foreground"
      aria-hidden
    >
      {ticks.map(({ mm, isMajor }) => {
        const offset = mmToDots(mm, dpi) * zoom
        const size = isMajor ? RULER_THICKNESS * 0.55 : RULER_THICKNESS * 0.28
        return (
          <g key={mm}>
            <line
              x1={horizontal ? offset : RULER_THICKNESS - size}
              y1={horizontal ? RULER_THICKNESS - size : offset}
              x2={horizontal ? offset : RULER_THICKNESS}
              y2={horizontal ? RULER_THICKNESS : offset}
              stroke="currentColor"
              strokeWidth={0.5}
            />
            {isMajor && offset > 0 && (
              <text
                x={horizontal ? offset + 2 : 2}
                y={horizontal ? 8 : offset - 2}
                fontSize={8}
                fill="currentColor"
              >
                {mm}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export const RULER_SIZE = RULER_THICKNESS
