/**
 * The label on the print head, drawn to scale.
 *
 * A bar the width of the head; the label laid on it from the left at its
 * real proportion; anything past the head's edge marked in the failure
 * colour. One glance answers "will this fit" before the paper decides. Drawn
 * only for a probed printer — an unprobed one has no head width, and a bar
 * of unknown length would be a guess dressed as a measurement.
 *
 * Inline SVG in the palette's own tokens (accent as a line, paper for the
 * label, destructive for the overhang); no colour is invented here.
 */
import { copy } from '../../i18n/index.ts'
import { headFigure, maxWidthFromCapabilities } from './head-figure.ts'
import type { Capabilities } from '../../api/types.ts'

export interface HeadFigureProps {
  labelWidthMm: number
  capabilities: Capabilities | null
}

const WIDTH = 240
const HEAD_H = 10
const LABEL_H = 22

export function HeadFigureView({ labelWidthMm, capabilities }: HeadFigureProps): React.JSX.Element | null {
  const maxWidthMm = maxWidthFromCapabilities(capabilities)
  const figure = headFigure({ labelWidthMm, maxWidthMm })
  if (figure === null || maxWidthMm === null) {
    return null
  }

  // The label is drawn at the head's scale. Past the head, it keeps its own
  // scale — the overhang is the same millimetres per pixel as the rest.
  const pxPerMm = WIDTH / maxWidthMm
  const labelPx = Math.min(WIDTH, labelWidthMm * pxPerMm)
  const overPx = Math.max(0, labelWidthMm - maxWidthMm) * pxPerMm
  const total = WIDTH + overPx
  const maxMm = Math.round(maxWidthMm * 10) / 10

  return (
    <figure className="flex flex-col gap-n2" data-head-figure data-overflow={overPx > 0 ? 'true' : undefined}>
      <svg
        role="img"
        aria-label={copy.print.headFigure(labelWidthMm, maxMm)}
        viewBox={`0 0 ${total} ${HEAD_H + LABEL_H + 6}`}
        width={total}
        height={HEAD_H + LABEL_H + 6}
        className="max-w-full"
      >
        {/* The head: a bar in the accent, as a line. */}
        <rect x={0.5} y={LABEL_H + 3.5} width={WIDTH - 1} height={HEAD_H - 1} rx={2} fill="none" stroke="var(--color-primary)" />
        {/* The label: paper, lying on the head from the left edge. */}
        <rect x={0.5} y={0.5} width={labelPx + overPx - 1} height={LABEL_H - 1} rx={1.5} className="paper" style={{ fill: 'var(--paper)' }} stroke="none" />
        {overPx > 0 && (
          <rect
            x={WIDTH}
            y={0.5}
            width={overPx - 0.5}
            height={LABEL_H - 1}
            fill="var(--color-destructive)"
            fillOpacity={0.35}
            stroke="var(--color-destructive)"
            data-overflow-mark
          />
        )}
      </svg>
      <figcaption className="text-2xs text-muted-foreground">
        {copy.print.headFigure(labelWidthMm, maxMm)}
        {figure.overflowMm > 0 && (
          <span className="text-destructive">{' · '}{copy.print.headOverflow(figure.overflowMm)}</span>
        )}
      </figcaption>
    </figure>
  )
}
