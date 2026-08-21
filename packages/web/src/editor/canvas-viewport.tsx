/**
 * The canvas with its rulers and zoom control.
 *
 * Zoom exists because a 50x30 mm label at 203 dpi is 400x240 pixels — small
 * enough that placing an element accurately at 1:1 is guesswork. Continuous
 * zoom rather than fixed steps: label sizes here run from 50 mm to 104 mm, and
 * a fixed ladder is either too coarse at one end or pointless at the other.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { layoutGrid, type LabelIR } from '@zenith/shared'
import { copy } from '../i18n/index.ts'
import { Button } from '../components/ui/button.tsx'
import { EditorCanvas, type CanvasProps } from './canvas.tsx'
import { RULER_SIZE, Ruler } from './ruler.tsx'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const WHEEL_SENSITIVITY = 0.0015

export type ViewportProps = Omit<CanvasProps, 'zoom'> & { ir: LabelIR }

export function CanvasViewport(props: ViewportProps): React.JSX.Element {
  const { ir } = props
  const grid = layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })
  const frameRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  const fitToWindow = useCallback(() => {
    const frame = frameRef.current
    if (frame === null) {
      return
    }
    const available = frame.clientWidth - RULER_SIZE - 16
    if (available <= 0) {
      return
    }
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, available / grid.widthDots)))
  }, [grid.widthDots])

  useLayoutEffect(fitToWindow, [fitToWindow])

  const onWheel = useCallback((event: React.WheelEvent) => {
    // Only with the modifier, so ordinary scrolling still scrolls the page.
    if (!event.ctrlKey && !event.metaKey) {
      return
    }
    event.preventDefault()
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * Math.exp(-event.deltaY * WHEEL_SENSITIVITY))),
    )
  }, [])

  return (
    <div className="space-y-2" ref={frameRef}>
      <div className="flex items-center gap-2 text-xs">
        <Button size="sm" variant="outline" onClick={fitToWindow}>
          {copy.editor.zoom.fit}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}>
          −
        </Button>
        <span className="w-12 text-center tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}>
          ＋
        </Button>
      </div>

      <div className="overflow-auto" onWheel={onWheel}>
        {/* Corner gap, then the horizontal ruler aligned to the canvas. */}
        <div className="flex">
          <div style={{ width: RULER_SIZE, height: RULER_SIZE }} />
          <Ruler lengthMm={ir.widthMm} dpi={ir.dpi} zoom={zoom} orientation="horizontal" />
        </div>
        <div className="flex">
          <Ruler lengthMm={ir.heightMm} dpi={ir.dpi} zoom={zoom} orientation="vertical" />
          <EditorCanvas {...props} zoom={zoom} />
        </div>
      </div>
    </div>
  )
}
