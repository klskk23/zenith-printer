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
import { spanLengthDots, type Span } from './ruler-span.ts'

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
  /** The selected element's extent on this axis, in dots. */
  highlight?: Span | null
}

/** Below this the dot count has nowhere to sit without covering the ticks. */
const MIN_LABEL_PX = 26

export function Ruler({
  lengthMm,
  dpi,
  zoom,
  orientation,
  highlight = null,
}: RulerProps): React.JSX.Element {
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
      {/*
        The selection, as a band across the ruler.
        Translucent and behind the ticks: it says where the element is and how
        wide it is without hiding the scale it is being read against. The dot
        count is the number that decides whether a barcode's quiet zone
        survives or a rule lands on a whole row, so it is spelled out — but
        only when the band is wide enough to hold it, since a number lying
        across the tick marks is worse than no number.
      */}
      {highlight !== null && (
        <g data-ruler-highlight pointerEvents="none">
          <rect
            x={horizontal ? highlight.startDots * zoom : 0}
            y={horizontal ? 0 : highlight.startDots * zoom}
            width={horizontal ? Math.max(spanLengthDots(highlight) * zoom, 1) : RULER_THICKNESS}
            height={horizontal ? RULER_THICKNESS : Math.max(spanLengthDots(highlight) * zoom, 1)}
            fill="currentColor"
            opacity={0.18}
          />
          {[highlight.startDots, highlight.endDots].map((edge, index) => (
            <line
              key={index}
              x1={horizontal ? edge * zoom : 0}
              y1={horizontal ? 0 : edge * zoom}
              x2={horizontal ? edge * zoom : RULER_THICKNESS}
              y2={horizontal ? RULER_THICKNESS : edge * zoom}
              stroke="currentColor"
              strokeWidth={1}
              opacity={0.55}
            />
          ))}
          {spanLengthDots(highlight) * zoom >= MIN_LABEL_PX && (
            <text
              x={horizontal ? ((highlight.startDots + highlight.endDots) / 2) * zoom : RULER_THICKNESS / 2}
              y={horizontal ? RULER_THICKNESS - 5 : ((highlight.startDots + highlight.endDots) / 2) * zoom}
              fontSize={8}
              fill="currentColor"
              textAnchor="middle"
              dominantBaseline={horizontal ? 'auto' : 'middle'}
              data-ruler-span
            >
              {spanLengthDots(highlight)}
            </text>
          )}
        </g>
      )}

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
