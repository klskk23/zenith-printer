/**
 * The canvas with its rulers and zoom control.
 *
 * Zoom exists because a 50x30 mm label at 203 dpi is 400x240 pixels — small
 * enough that placing an element accurately at 1:1 is guesswork.
 *
 * The label sizes itself to the space it has rather than waiting to be told to.
 * There is no "fit to window" button: fitting is the default state, and a
 * button for the thing that should already have happened is a button that
 * mostly reports a failure to do it. Resizing the panel re-fits, until someone
 * zooms deliberately — after which their choice stands, because a view that
 * silently undoes a deliberate zoom is worse than one that never fits at all.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { layoutGrid, type LabelIR } from '@zenith/shared'
import { copy } from '../i18n/index.ts'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { EditorCanvas, type CanvasProps } from './canvas.tsx'
import { MAX_ZOOM, MIN_ZOOM, clampZoom, fitZoom, isZoomGesture, zoomFromWheel } from './zoom.ts'
import { RULER_SIZE, Ruler } from './ruler.tsx'
import { selectionSpans } from './ruler-span.ts'

export type ViewportProps = Omit<CanvasProps, 'zoom'> & {
  ir: LabelIR
  /** Shown in the status strip; explains the shaded regions, or their absence. */
  marginNote?: string
}

export function CanvasViewport({ marginNote, ...props }: ViewportProps): React.JSX.Element {
  const { ir } = props
  const grid = layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })
  const areaRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  // Recomputed as the element moves, so the band follows a drag rather than
  // reporting where the element used to be.
  const spans = useMemo(
    () => selectionSpans(props.ir, props.selectedId),
    [props.ir, props.selectedId],
  )

  /** Once someone zooms on purpose, stop re-fitting behind their back. */
  const manual = useRef(false)

  const fit = useCallback(() => {
    const area = areaRef.current
    if (area === null || manual.current) {
      return
    }
    const availableWidth = area.clientWidth - RULER_SIZE
    if (availableWidth <= 0) {
      return
    }

    setZoom(
      fitZoom({
        availableWidth,
        availableHeight: area.clientHeight - RULER_SIZE,
        widthDots: grid.widthDots,
        heightDots: grid.heightDots,
      }),
    )
  }, [grid.widthDots, grid.heightDots])

  useLayoutEffect(fit, [fit])

  // Re-fit when the column is dragged wider or narrower. ResizeObserver is
  // absent in some environments; without it the initial fit still applies.
  useEffect(() => {
    const area = areaRef.current
    if (area === null || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => fit())
    observer.observe(area)
    return () => observer.disconnect()
  }, [fit])

  const setManualZoom = useCallback((next: number) => {
    manual.current = true
    setZoom(clampZoom(next))
  }, [])

  // Read inside the native listener, which is registered once and would
  // otherwise close over the zoom value it saw at mount.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  /**
   * The wheel listener is native and non-passive.
   *
   * React registers its own at the root as passive, so `preventDefault` inside
   * an `onWheel` prop is silently ignored — which is what let the page scroll
   * sideways underneath the zoom. The rule for what counts as a zoom lives in
   * zoom.ts; this only delivers the event to it.
   */
  useEffect(() => {
    const area = areaRef.current
    if (area === null) {
      return
    }
    const onWheel = (event: WheelEvent): void => {
      if (!isZoomGesture(event)) {
        return
      }
      event.preventDefault()
      setManualZoom(zoomFromWheel(zoomRef.current, event))
    }
    area.addEventListener('wheel', onWheel, { passive: false })
    return () => area.removeEventListener('wheel', onWheel)
  }, [setManualZoom])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The label, centred in whatever space the column has. */}
      <div
        ref={areaRef}
        data-canvas-area
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
      >
        <div className="inline-block">
          <div className="flex">
            <div style={{ width: RULER_SIZE, height: RULER_SIZE }} />
            <Ruler
              lengthMm={ir.widthMm}
              dpi={ir.dpi}
              zoom={zoom}
              orientation="horizontal"
              highlight={spans?.x ?? null}
            />
          </div>
          <div className="flex">
            <Ruler
              lengthMm={ir.heightMm}
              dpi={ir.dpi}
              zoom={zoom}
              orientation="vertical"
              highlight={spans?.y ?? null}
            />
            <EditorCanvas {...props} zoom={zoom} />
          </div>
        </div>
      </div>

      {/* Zoom sits at the foot of the column, out of the way of the work. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-1.5">
        <Label htmlFor="canvas-zoom" className="text-[11px]">
          {copy.editor.zoom.label}
        </Label>
        <Input
          id="canvas-zoom"
          type="number"
          min={Math.round(MIN_ZOOM * 100)}
          max={Math.round(MAX_ZOOM * 100)}
          step={10}
          className="h-7 w-20 text-xs"
          value={Math.round(zoom * 100)}
          onChange={(event) => {
            const percent = Number(event.target.value)
            if (Number.isFinite(percent) && percent > 0) {
              setManualZoom(percent / 100)
            }
          }}
        />
        <span className="text-[11px] text-muted-foreground">%</span>
        <span className="ml-2 text-[11px] text-muted-foreground">{copy.editor.zoom.hint}</span>
        {/* FR-065: with no profile there are no margins to draw, and saying so
            beats a canvas that merely looks like it has none. */}
        {marginNote !== undefined && (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">{marginNote}</span>
        )}
      </div>
    </div>
  )
}
